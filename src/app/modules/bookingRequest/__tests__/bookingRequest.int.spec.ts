import { BookingStatus, PaymentProvider, PaymentStatus, Role } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../../../../app';
import {
  bookingPayload,
  createBookableTrip,
  createUser,
  prisma,
  resetDb,
  seatsLeft,
  tokenFor,
} from '../../../../../test/integration/helpers';

/**
 * Spec 0004: customer change requests and the staff Requests list, against a real Postgres.
 * Run with `npm run test:int`.
 */
const api = () => request(app);
const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A paid (Stripe collected) guest booking for 2 adults departing in `departInHours`. */
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
  const payment = await prisma.payment.update({
    where: { bookingId: res.body.data.id },
    data: {
      provider: PaymentProvider.STRIPE,
      status: PaymentStatus.COMPLETED,
      stripePaymentIntentId: `pi_test_${res.body.data.id}`,
      paidAt: new Date(),
    },
  });
  return { ...trip, booking: res.body.data, email: payload.leadPassengerEmail, payment };
}

const createRequest = (reference: string, body: Record<string, unknown>) =>
  api().post(`/api/v1/bookings/${reference}/requests`).send(body);

describe('POST /bookings/:idOrReference/requests (customer)', () => {
  it('201: inside 24h a CANCEL request is created and the booking shows it pending (AC-5, AC-4)', async () => {
    const { booking, email } = await bookPaid(5);

    const res = await createRequest(booking.reference, { email, type: 'CANCEL', reason: 'Sick' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'CANCEL', status: 'PENDING', leg: null, reason: 'Sick' });
    const get = await api().get(`/api/v1/bookings/${booking.reference}`).query({ email });
    expect(get.body.data.cancellation.mode).toBe('NONE');
    expect(get.body.data.cancellation.pendingRequest).toMatchObject({ id: res.body.data.id });
  });

  it('409 REQUEST_NOT_ALLOWED 24h or more ahead, where the customer can cancel on their own', async () => {
    const { booking, email } = await bookPaid(48);
    const res = await createRequest(booking.reference, { email, type: 'CANCEL' });
    expect(res.status).toBe(409);
    expect(res.body.data.code).toBe('REQUEST_NOT_ALLOWED');
  });

  it('404: a guest with the wrong email cannot create a request (AC-16)', async () => {
    const { booking } = await bookPaid(5);
    const res = await createRequest(booking.reference, { email: 'someone@else.test', type: 'CANCEL' });
    expect(res.status).toBe(404);
  });

  it('one pending at a time, withdraw frees it, the 4th request hits the limit (AC-6)', async () => {
    const { booking, email } = await bookPaid(5);

    const first = await createRequest(booking.reference, { email, type: 'CANCEL' });
    expect(first.status).toBe(201);
    const second = await createRequest(booking.reference, { email, type: 'RESCHEDULE' });
    expect(second.status).toBe(409);
    expect(second.body.data.code).toBe('REQUEST_PENDING');

    for (const previous of [first.body.data.id]) {
      const withdraw = await api()
        .patch(`/api/v1/bookings/${booking.reference}/requests/${previous}/withdraw`)
        .send({ email });
      expect(withdraw.status).toBe(200);
      expect(withdraw.body.data.status).toBe('WITHDRAWN');
    }
    for (let i = 0; i < 2; i++) {
      const next = await createRequest(booking.reference, { email, type: 'CANCEL' });
      expect(next.status).toBe(201);
      await api()
        .patch(`/api/v1/bookings/${booking.reference}/requests/${next.body.data.id}/withdraw`)
        .send({ email });
    }

    const fourth = await createRequest(booking.reference, { email, type: 'CANCEL' });
    expect(fourth.status).toBe(409);
    expect(fourth.body.data.code).toBe('REQUEST_LIMIT');
  });

  it('two creates at once: exactly one pending request is stored', async () => {
    const { booking, email } = await bookPaid(5);
    const results = await Promise.all(
      [1, 2].map(() => createRequest(booking.reference, { email, type: 'CANCEL' })),
    );
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.bookingRequest.count({ where: { status: 'PENDING' } })).toBe(1);
  });

  it('CHECKED_IN round trip: only a return reschedule is allowed (AC-5b)', async () => {
    const { booking, email, schedule, route, ferry } = await bookPaid(5);
    const returnDeparture = new Date(Date.now() + 10 * HOUR);
    const reverseRoute = await prisma.route.create({
      data: {
        departurePortId: route.destinationPortId,
        destinationPortId: route.departurePortId,
        durationMinutes: 45,
      },
    });
    const returnSchedule = await prisma.schedule.create({
      data: {
        routeId: reverseRoute.id,
        ferryId: ferry.id,
        departureTime: returnDeparture,
        arrivalTime: new Date(returnDeparture.getTime() + 45 * 60 * 1000),
        adultFare: 40,
        childFare: 20,
        availableSeats: 10,
      },
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.CHECKED_IN, tripType: 'ROUND_TRIP', returnScheduleId: returnSchedule.id },
    });
    expect(schedule.id).not.toBe(returnSchedule.id);

    const cancel = await createRequest(booking.reference, { email, type: 'CANCEL' });
    expect(cancel.status).toBe(409);
    const reschedule = await createRequest(booking.reference, { email, type: 'RESCHEDULE' });
    expect(reschedule.status).toBe(201);
    expect(reschedule.body.data.leg).toBe('RETURN');
  });
});

describe('GET /booking-requests and PATCH /booking-requests/:requestId/resolve (staff)', () => {
  it('operator sees only their own requests; pendingCount ignores the status filter (AC-7)', async () => {
    const mine = await bookPaid(5);
    const theirs = await bookPaid(5);
    await createRequest(mine.booking.reference, { email: mine.email, type: 'CANCEL' });
    await createRequest(theirs.booking.reference, { email: theirs.email, type: 'CANCEL' });
    const token = await tokenFor(mine.operatorUser);

    const res = await api().get('/api/v1/booking-requests').query({ status: 'REJECTED' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(0);
    expect(res.body.data.meta.pendingCount).toBe(1);

    const pending = await api().get('/api/v1/booking-requests').query({ status: 'PENDING' }).set('Authorization', `Bearer ${token}`);
    expect(pending.body.data.data).toHaveLength(1);
    expect(pending.body.data.data[0].booking).toMatchObject({
      reference: mine.booking.reference,
      passengers: 2,
      refundCents: mine.payment.amountCents,
    });
    expect(pending.body.data.data[0].overdue).toBe(false);

    const admin = await createUser(Role.ADMIN);
    const all = await api().get('/api/v1/booking-requests').set('Authorization', `Bearer ${await tokenFor(admin)}`);
    expect(all.body.data.meta.total).toBe(2);
  });

  it('403: a customer cannot list requests', async () => {
    const user = await createUser(Role.USER);
    const res = await api().get('/api/v1/booking-requests').set('Authorization', `Bearer ${await tokenFor(user)}`);
    expect(res.status).toBe(403);
  });

  it('resolve CANCEL after departure: booking cancelled, seats back, full refund, request closed (AC-8, AC-7)', async () => {
    const { booking, email, schedule, payment, operatorUser } = await bookPaid(5);
    const created = await createRequest(booking.reference, { email, type: 'CANCEL' });
    // The trip leaves while the request still waits.
    await prisma.schedule.update({ where: { id: schedule.id }, data: { departureTime: new Date(Date.now() - HOUR) } });
    const token = await tokenFor(operatorUser);

    const list = await api().get('/api/v1/booking-requests').set('Authorization', `Bearer ${token}`);
    expect(list.body.data.data[0].overdue).toBe(true);

    const res = await api()
      .patch(`/api/v1/booking-requests/${created.body.data.id}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'CANCEL', note: 'Approved' });

    expect(res.status).toBe(200);
    expect(res.body.data.request).toMatchObject({ status: 'CANCELLED', staffNote: 'Approved' });
    expect(res.body.data.refund).toMatchObject({ amountCents: payment.amountCents });
    expect(await seatsLeft(schedule.id)).toBe(10);
    const saved = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(saved.resolvedByUserId).toBe(operatorUser.id);
    expect(saved.resolvedAt).not.toBeNull();
    const refund = await prisma.refund.findFirstOrThrow({ where: { paymentId: payment.id } });
    expect(refund).toMatchObject({ reason: 'CUSTOMER_CANCEL', requestedByUserId: operatorUser.id });
  });

  it('resolve REJECT keeps the booking and stores the note; a note is required (AC-10)', async () => {
    const { booking, email, schedule, operatorUser } = await bookPaid(5);
    const created = await createRequest(booking.reference, { email, type: 'RESCHEDULE' });
    const token = await tokenFor(operatorUser);
    const url = `/api/v1/booking-requests/${created.body.data.id}/resolve`;

    const noNote = await api().patch(url).set('Authorization', `Bearer ${token}`).send({ action: 'REJECT' });
    expect(noNote.status).toBe(400);

    const res = await api().patch(url).set('Authorization', `Bearer ${token}`).send({ action: 'REJECT', note: 'Trip is full' });
    expect(res.status).toBe(200);
    expect(res.body.data.request).toMatchObject({ status: 'REJECTED', staffNote: 'Trip is full' });
    expect(res.body.data.booking.status).toBe('CONFIRMED');
    expect(await seatsLeft(schedule.id)).toBe(8);

    const get = await api().get(`/api/v1/bookings/${booking.reference}`).query({ email });
    expect(get.body.data.cancellation.lastResolvedRequest).toMatchObject({ status: 'REJECTED', staffNote: 'Trip is full' });
  });

  it('404: operator B cannot resolve operator A’s request (AC-16)', async () => {
    const a = await bookPaid(5);
    const b = await bookPaid(5);
    const created = await createRequest(a.booking.reference, { email: a.email, type: 'CANCEL' });

    const res = await api()
      .patch(`/api/v1/booking-requests/${created.body.data.id}/resolve`)
      .set('Authorization', `Bearer ${await tokenFor(b.operatorUser)}`)
      .send({ action: 'CANCEL' });
    expect(res.status).toBe(404);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: a.booking.id } })).status).toBe('CONFIRMED');
  });

  it('two staff resolve at once: one wins, the other gets 409, seats restored once (AC-13)', async () => {
    const { booking, email, schedule, operatorUser } = await bookPaid(5);
    const created = await createRequest(booking.reference, { email, type: 'CANCEL' });
    const admin = await createUser(Role.ADMIN);
    const url = `/api/v1/booking-requests/${created.body.data.id}/resolve`;

    const results = await Promise.all([
      api().patch(url).set('Authorization', `Bearer ${await tokenFor(operatorUser)}`).send({ action: 'CANCEL' }),
      api().patch(url).set('Authorization', `Bearer ${await tokenFor(admin)}`).send({ action: 'CANCEL' }),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await seatsLeft(schedule.id)).toBe(10);
  });

  it('409 BOARDED: a checked in booking cannot be cancelled through a request (AC-8)', async () => {
    const { booking, email, operatorUser } = await bookPaid(5);
    const created = await createRequest(booking.reference, { email, type: 'CANCEL' });
    // Bypass check in (which would close the request) to reach the guard.
    await prisma.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.CHECKED_IN } });

    const res = await api()
      .patch(`/api/v1/booking-requests/${created.body.data.id}/resolve`)
      .set('Authorization', `Bearer ${await tokenFor(operatorUser)}`)
      .send({ action: 'CANCEL' });
    expect(res.status).toBe(409);
    expect(res.body.data.code).toBe('BOARDED');
  });
});
