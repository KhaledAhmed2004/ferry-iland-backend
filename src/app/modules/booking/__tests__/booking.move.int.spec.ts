import { BookingStatus, PaymentProvider, PaymentStatus, Role } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../../../../app';
import {
  addReturnLeg,
  bookingPayload,
  createBookableTrip,
  createUser,
  prisma,
  resetDb,
  seatsLeft,
  tokenFor,
} from '../../../../../test/integration/helpers';

/**
 * Spec 0004: the move service (move options, direct staff move, RESCHEDULE resolution, the
 * customer's preferred trip), against a real Postgres. Run with `npm run test:int`.
 */
const api = () => request(app);
const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

type Trip = Awaited<ReturnType<typeof createBookableTrip>>;

/** Another trip on the same route with the same ferry, departing in `departInHours`. */
const addTrip = (trip: Trip, departInHours: number, seats = 10, ferryId = trip.ferry.id) => {
  const departure = new Date(Date.now() + departInHours * HOUR);
  return prisma.schedule.create({
    data: {
      routeId: trip.route.id,
      ferryId,
      departureTime: departure,
      arrivalTime: new Date(departure.getTime() + 45 * 60 * 1000),
      adultFare: 40,
      childFare: 20,
      availableSeats: seats,
    },
  });
};

/** A paid (Stripe collected) guest booking for 2 adults on a trip departing in `departInHours`. */
async function bookPaid(departInHours: number) {
  const trip = await createBookableTrip({ seats: 10 });
  const payload = bookingPayload(trip.schedule.id, { adults: 2 });
  const res = await api().post('/api/v1/bookings').send(payload);
  expect(res.status).toBe(201);
  await prisma.schedule.update({
    where: { id: trip.schedule.id },
    data: {
      departureTime: new Date(Date.now() + departInHours * HOUR),
      arrivalTime: new Date(Date.now() + departInHours * HOUR + 45 * 60 * 1000),
    },
  });
  await prisma.payment.update({
    where: { bookingId: res.body.data.id },
    data: {
      provider: PaymentProvider.STRIPE,
      status: PaymentStatus.COMPLETED,
      stripePaymentIntentId: `pi_test_${res.body.data.id}`,
      paidAt: new Date(),
    },
  });
  return { ...trip, booking: res.body.data, email: payload.leadPassengerEmail };
}

const bearer = async (user: Parameters<typeof tokenFor>[0]) => `Bearer ${await tokenFor(user)}`;

describe('GET /bookings/:idOrReference/move-options (AC-15)', () => {
  it('lists only same route, same operator, open future trips with enough seats', async () => {
    const trip = await bookPaid(48);
    const later = await addTrip(trip, 72);
    await addTrip(trip, 96, 1); // too few seats for 2 passengers
    const otherOperator = await createBookableTrip();
    await prisma.schedule.create({
      data: {
        routeId: trip.route.id,
        ferryId: otherOperator.ferry.id,
        departureTime: new Date(Date.now() + 80 * HOUR),
        arrivalTime: new Date(Date.now() + 81 * HOUR),
        adultFare: 40,
        childFare: 20,
        availableSeats: 10,
      },
    });

    const res = await api()
      .get(`/api/v1/bookings/${trip.booking.reference}/move-options`)
      .set('Authorization', await bearer(trip.operatorUser));

    expect(res.status).toBe(200);
    expect(res.body.data.map((o: { scheduleId: string }) => o.scheduleId)).toEqual([later.id]);
    expect(res.body.data[0]).toMatchObject({ availableSeats: 10 });
  });

  it('a guest with the lead email can read options; a stranger gets 404 (AC-16)', async () => {
    const trip = await bookPaid(48);
    await addTrip(trip, 72);
    const ok = await api()
      .get(`/api/v1/bookings/${trip.booking.reference}/move-options`)
      .query({ email: trip.email });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toHaveLength(1);

    const stranger = await api().get(`/api/v1/bookings/${trip.booking.reference}/move-options`);
    expect(stranger.status).toBe(404);
  });
});

describe('POST /bookings/:idOrReference/move (direct staff move)', () => {
  it('moves seats, keeps tickets, writes a BookingChange, closes a pending request (AC-13, AC-14, AC-19)', async () => {
    const trip = await bookPaid(5);
    const target = await addTrip(trip, 30);
    const pending = await api()
      .post(`/api/v1/bookings/${trip.booking.reference}/requests`)
      .send({ type: 'RESCHEDULE', email: trip.email });
    expect(pending.status).toBe(201);
    const ticketsBefore = await prisma.ticket.findMany({ where: { bookingId: trip.booking.id } });

    const res = await api()
      .post(`/api/v1/bookings/${trip.booking.reference}/move`)
      .set('Authorization', await bearer(trip.operatorUser))
      .send({ outboundScheduleId: target.id, reason: 'No show' });

    expect(res.status).toBe(200);
    expect(res.body.data.changes).toHaveLength(1);
    expect(await seatsLeft(trip.schedule.id)).toBe(10);
    expect(await seatsLeft(target.id)).toBe(8);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: trip.booking.id },
      include: { tickets: true, changes: true, requests: true, payment: true },
    });
    expect(booking.scheduleId).toBe(target.id);
    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(booking.tickets.map(t => t.ticketNumber).sort()).toEqual(
      ticketsBefore.map(t => t.ticketNumber).sort(),
    );
    expect(booking.payment?.status).toBe(PaymentStatus.COMPLETED);
    expect(booking.changes[0]).toMatchObject({
      leg: 'OUTBOUND',
      fromScheduleId: trip.schedule.id,
      toScheduleId: target.id,
      requestId: null,
      changedByUserId: trip.operatorUser.id,
      reason: 'No show',
    });
    expect(booking.requests[0]).toMatchObject({
      status: 'RESCHEDULED',
      staffNote: 'Closed: booking moved',
      resolvedByUserId: trip.operatorUser.id,
    });
  });

  it('refuses a full trip and another operator\'s trip with 409 MOVE_NOT_ALLOWED, changing nothing (AC-11)', async () => {
    const trip = await bookPaid(48);
    const full = await addTrip(trip, 72, 1);
    const other = await createBookableTrip();
    const auth = await bearer(trip.operatorUser);

    for (const scheduleId of [full.id, other.schedule.id]) {
      const res = await api()
        .post(`/api/v1/bookings/${trip.booking.reference}/move`)
        .set('Authorization', auth)
        .send({ outboundScheduleId: scheduleId });
      expect(res.status).toBe(409);
      expect(res.body.data.code).toBe('MOVE_NOT_ALLOWED');
    }
    expect(await seatsLeft(trip.schedule.id)).toBe(8);
    expect(await seatsLeft(full.id)).toBe(1);
    expect(await prisma.bookingChange.count()).toBe(0);
  });

  it('another operator gets 404 (AC-16)', async () => {
    const trip = await bookPaid(48);
    const target = await addTrip(trip, 72);
    const other = await createBookableTrip();
    const res = await api()
      .post(`/api/v1/bookings/${trip.booking.reference}/move`)
      .set('Authorization', await bearer(other.operatorUser))
      .send({ outboundScheduleId: target.id });
    expect(res.status).toBe(404);
  });

  it('a no show leg moves 23h after departure but not 25h after (AC-12)', async () => {
    const trip = await bookPaid(-23);
    const target = await addTrip(trip, 10);
    const admin = await createUser(Role.ADMIN);
    const auth = await bearer(admin);

    const ok = await api()
      .post(`/api/v1/bookings/${trip.booking.reference}/move`)
      .set('Authorization', auth)
      .send({ outboundScheduleId: target.id });
    expect(ok.status).toBe(200);

    const late = await bookPaid(-25);
    const lateTarget = await addTrip(late, 10);
    const refused = await api()
      .post(`/api/v1/bookings/${late.booking.reference}/move`)
      .set('Authorization', auth)
      .send({ outboundScheduleId: lateTarget.id });
    expect(refused.status).toBe(409);
  });

  it('a checked in outbound cannot move: 409 BOARDED (AC-12)', async () => {
    const trip = await bookPaid(2);
    const target = await addTrip(trip, 30);
    await prisma.booking.update({
      where: { id: trip.booking.id },
      data: { status: BookingStatus.CHECKED_IN },
    });
    const res = await api()
      .post(`/api/v1/bookings/${trip.booking.reference}/move`)
      .set('Authorization', await bearer(trip.operatorUser))
      .send({ outboundScheduleId: target.id });
    expect(res.status).toBe(409);
    expect(res.body.data.code).toBe('BOARDED');
  });

  it('a move racing a cancel: one wins, seats stay right on every trip (AC-13)', async () => {
    const trip = await bookPaid(48);
    const target = await addTrip(trip, 72);
    const admin = await createUser(Role.ADMIN);
    const auth = await bearer(admin);

    const [move, cancel] = await Promise.all([
      api()
        .post(`/api/v1/bookings/${trip.booking.reference}/move`)
        .set('Authorization', auth)
        .send({ outboundScheduleId: target.id }),
      api().patch(`/api/v1/bookings/${trip.booking.reference}/cancel`).set('Authorization', auth),
    ]);

    const statuses = [move.status, cancel.status].sort();
    expect(statuses[0]).toBe(200);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: trip.booking.id } });
    const seatsOn = { source: await seatsLeft(trip.schedule.id), target: await seatsLeft(target.id) };
    if (booking.status === BookingStatus.CANCELLED) {
      expect(seatsOn.source + seatsOn.target).toBe(20);
    } else {
      expect(seatsOn).toEqual({ source: 10, target: 8 });
    }
  });
});

describe('two leg bookings and what a move changes (AC-11, AC-14, AC-16)', () => {
  /** `daysAhead` days from now at `utcHour`:00 UTC, so days are deterministic. */
  const dayAt = (daysAhead: number, utcHour: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysAhead);
    d.setUTCHours(utcHour, 0, 0, 0);
    return d;
  };
  const setDeparture = (id: string, departure: Date) =>
    prisma.schedule.update({
      where: { id },
      data: { departureTime: departure, arrivalTime: new Date(departure.getTime() + 45 * 60 * 1000) },
    });

  async function bookTwoLeg(trip: Trip, tripType: 'ROUND_TRIP' | 'SAME_DAY_RETURN', returnScheduleId: string) {
    const payload = { ...bookingPayload(trip.schedule.id, { adults: 2 }), tripType, returnScheduleId };
    const res = await api().post('/api/v1/bookings').send(payload);
    expect(res.status, res.body.message).toBe(201);
    return res.body.data;
  }

  it('a round trip outbound cannot move to a trip without the round trip fare; one with it is fine', async () => {
    const trip = await createBookableTrip({ seats: 10 });
    const { returnSchedule } = await addReturnLeg(trip, { returnInHours: 120 });
    const booking = await bookTwoLeg(trip, 'ROUND_TRIP', returnSchedule.id);
    const noBundle = await addTrip(trip, 80);
    const withBundle = await addTrip(trip, 90);
    await prisma.schedule.update({ where: { id: withBundle.id }, data: { adultRoundTripFare: 70 } });
    const auth = await bearer(trip.operatorUser);

    const refused = await api()
      .post(`/api/v1/bookings/${booking.reference}/move`)
      .set('Authorization', auth)
      .send({ outboundScheduleId: noBundle.id });
    const options = await api().get(`/api/v1/bookings/${booking.reference}/move-options`).set('Authorization', auth);
    const moved = await api()
      .post(`/api/v1/bookings/${booking.reference}/move`)
      .set('Authorization', auth)
      .send({ outboundScheduleId: withBundle.id });

    expect(refused.status).toBe(409);
    expect(refused.body.data.code).toBe('MOVE_NOT_ALLOWED');
    expect(refused.body.message).toMatch(/round trip fare/);
    expect(options.body.data.map((o: { scheduleId: string }) => o.scheduleId)).toEqual([withBundle.id]);
    expect(moved.status).toBe(200);
    expect(await seatsLeft(withBundle.id)).toBe(8);
  });

  it('a same day return outbound cannot move to another day', async () => {
    const trip = await createBookableTrip({ seats: 10 });
    await setDeparture(trip.schedule.id, dayAt(5, 12));
    const { returnSchedule } = await addReturnLeg(trip, { returnInHours: 1, bundle: 'SAME_DAY_RETURN' });
    await setDeparture(returnSchedule.id, dayAt(5, 18));
    const booking = await bookTwoLeg(trip, 'SAME_DAY_RETURN', returnSchedule.id);
    // The day before: still ahead of the return, so only the same day rule can refuse it.
    const dayBefore = await addTrip(trip, 1);
    await setDeparture(dayBefore.id, dayAt(4, 12));
    const sameDay = await addTrip(trip, 1);
    await setDeparture(sameDay.id, dayAt(5, 14));
    await prisma.schedule.updateMany({
      where: { id: { in: [dayBefore.id, sameDay.id] } },
      data: { adultSameDayFare: 60 },
    });
    const auth = await bearer(trip.operatorUser);

    const refused = await api()
      .post(`/api/v1/bookings/${booking.reference}/move`)
      .set('Authorization', auth)
      .send({ outboundScheduleId: dayBefore.id });
    const moved = await api()
      .post(`/api/v1/bookings/${booking.reference}/move`)
      .set('Authorization', auth)
      .send({ outboundScheduleId: sameDay.id });

    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/same day/);
    expect(moved.status).toBe(200);
  });

  it('after a move the manifests and the boarding pass follow the booking to the new trip (AC-14)', async () => {
    const trip = await bookPaid(48);
    const target = await addTrip(trip, 72);
    const auth = await bearer(trip.operatorUser);
    const moved = await api()
      .post(`/api/v1/bookings/${trip.booking.reference}/move`)
      .set('Authorization', auth)
      .send({ outboundScheduleId: target.id });
    expect(moved.status).toBe(200);
    const manifestRefs = async (tripId: string) => {
      const res = await api().get('/api/v1/tickets/manifest').query({ tripId }).set('Authorization', auth);
      expect(res.status).toBe(200);
      return res.body.data.passengers.map((p: { bookingReference: string }) => p.bookingReference);
    };
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { bookingId: trip.booking.id } });

    const pass = await api().get(`/api/v1/tickets/pass/${ticket.ticketNumber}`);

    expect(await manifestRefs(trip.schedule.id)).not.toContain(trip.booking.reference);
    expect(await manifestRefs(target.id)).toContain(trip.booking.reference);
    expect(pass.status).toBe(200);
    expect(JSON.stringify(pass.body.data)).toContain(target.departureTime.toISOString());
  });

  it('another operator cannot read move options for this booking: 404 (AC-16)', async () => {
    const trip = await bookPaid(48);
    await addTrip(trip, 72);
    const other = await createBookableTrip();

    const res = await api()
      .get(`/api/v1/bookings/${trip.booking.reference}/move-options`)
      .set('Authorization', await bearer(other.operatorUser));

    expect(res.status).toBe(404);
  });
});

describe('RESCHEDULE resolution and preferred trips (AC-5, AC-9)', () => {
  it('staff resolve RESCHEDULE moves the booking and links the change to the request', async () => {
    const trip = await bookPaid(5);
    const target = await addTrip(trip, 30);
    const created = await api()
      .post(`/api/v1/bookings/${trip.booking.reference}/requests`)
      .send({ type: 'RESCHEDULE', email: trip.email, preferredScheduleId: target.id });
    expect(created.status).toBe(201);

    const stored = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(stored.preferredScheduleId).toBe(target.id);

    const res = await api()
      .patch(`/api/v1/booking-requests/${created.body.data.id}/resolve`)
      .set('Authorization', await bearer(trip.operatorUser))
      .send({ action: 'RESCHEDULE', outboundScheduleId: target.id, note: 'Moved to the morning trip' });

    expect(res.status).toBe(200);
    expect(res.body.data.request.status).toBe('RESCHEDULED');
    const change = await prisma.bookingChange.findFirstOrThrow({ where: { bookingId: trip.booking.id } });
    expect(change.requestId).toBe(created.body.data.id);
    expect(await seatsLeft(target.id)).toBe(8);
  });

  it('a preferred trip the move rules refuse returns 409 MOVE_NOT_ALLOWED and creates nothing', async () => {
    const trip = await bookPaid(5);
    const other = await createBookableTrip();
    const res = await api()
      .post(`/api/v1/bookings/${trip.booking.reference}/requests`)
      .send({ type: 'RESCHEDULE', email: trip.email, preferredScheduleId: other.schedule.id });
    expect(res.status).toBe(409);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });
});
