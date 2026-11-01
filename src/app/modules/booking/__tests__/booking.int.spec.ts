import { AccountStatus, BookingStatus, PaymentStatus, Role, TripStatus } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../../../../app';
import {
  bookingPayload,
  createBookableTrip,
  createUser,
  findKeysDeep,
  prisma,
  resetDb,
  seatsLeft,
  tokenFor,
} from '../../../../../test/integration/helpers';

/**
 * Booking against a real Postgres (<db>_test): seats, money, concurrency, cancellation,
 * access rules and response shape. Run with `npm run test:int`.
 */
const api = () => request(app);

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/v1/bookings — create', () => {
  it('201: books 1 adult + 1 child, decrements seats by 2, prices in cents', async () => {
    const { schedule } = await createBookableTrip({ seats: 10, adultFare: 40, childFare: 20 });

    const res = await api()
      .post('/api/v1/bookings')
      .send(bookingPayload(schedule.id, { adults: 1, children: 1 }));

    expect(res.status).toBe(201);
    const booking = res.body.data;
    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(booking.reference).toBeTruthy();
    expect(booking.tickets).toHaveLength(2);
    expect(booking.totalAmount).toBe(60);
    expect(booking.payment).toMatchObject({ amountCents: 6000, status: PaymentStatus.PENDING });

    expect(await seatsLeft(schedule.id)).toBe(8);
    expect(await prisma.ticket.count({ where: { bookingId: booking.id } })).toBe(2);
  });

  it('links the booking to the signed-in user so it shows under /bookings/my', async () => {
    const { schedule } = await createBookableTrip();
    const user = await createUser(Role.USER);
    const token = await tokenFor(user);

    const res = await api()
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(bookingPayload(schedule.id, { email: user.email }));
    expect(res.status).toBe(201);

    const saved = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(saved.userId, 'booking made while signed in should belong to that user').toBe(user.id);

    const mine = await api().get('/api/v1/bookings/my').set('Authorization', `Bearer ${token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((b: { id: string }) => b.id)).toContain(res.body.data.id);
  });

  it('401: an invalid token is rejected instead of silently booking as a guest', async () => {
    const { schedule } = await createBookableTrip({ seats: 10 });

    const res = await api()
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer not-a-real-token')
      .send(bookingPayload(schedule.id));

    expect(res.status).toBe(401);
    expect(await seatsLeft(schedule.id)).toBe(10);
    expect(await prisma.booking.count()).toBe(0);
  });

  it('400: asking for more seats than are left changes nothing', async () => {
    const { schedule } = await createBookableTrip({ seats: 2 });

    const res = await api().post('/api/v1/bookings').send(bookingPayload(schedule.id, { adults: 3 }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not enough available seats/i);
    expect(await seatsLeft(schedule.id)).toBe(2);
    expect(await prisma.booking.count()).toBe(0);
  });

  it.each([TripStatus.CANCELLED, TripStatus.DEPARTED, TripStatus.ARRIVED])(
    '400: cannot book a %s trip',
    async (status) => {
      const { schedule } = await createBookableTrip({ seats: 10, status });

      const res = await api().post('/api/v1/bookings').send(bookingPayload(schedule.id));

      expect(res.status).toBe(400);
      expect(await seatsLeft(schedule.id)).toBe(10);
      expect(await prisma.booking.count()).toBe(0);
    },
  );

  it('404: unknown schedule', async () => {
    const res = await api()
      .post('/api/v1/bookings')
      .send(bookingPayload('00000000-0000-4000-8000-000000000000'));

    expect(res.status).toBe(404);
  });
});

describe('Concurrency — no overselling', () => {
  it('two people racing for the last seat: exactly one wins', async () => {
    const { schedule } = await createBookableTrip({ seats: 1 });

    const results = await Promise.all(
      [1, 2].map(() => api().post('/api/v1/bookings').send(bookingPayload(schedule.id))),
    );

    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await seatsLeft(schedule.id)).toBe(0);
    expect(await prisma.booking.count()).toBe(1);
  });

  it('10 simultaneous single-seat bookings on 5 seats: 5 succeed, seats end at 0', async () => {
    const { schedule } = await createBookableTrip({ seats: 5 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => api().post('/api/v1/bookings').send(bookingPayload(schedule.id))),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 400)).toHaveLength(5);
    expect(await seatsLeft(schedule.id)).toBe(0);
    expect(await prisma.booking.count()).toBe(5);
  });
});

describe('PATCH /api/v1/bookings/:id/cancel', () => {
  async function bookGuest(seats = 10, adults = 2) {
    const trip = await createBookableTrip({ seats });
    const payload = bookingPayload(trip.schedule.id, { adults });
    const res = await api().post('/api/v1/bookings').send(payload);
    expect(res.status).toBe(201);
    return { ...trip, booking: res.body.data, email: payload.leadPassengerEmail };
  }

  it('200: guest cancels with matching email — seats come back, payment cancelled', async () => {
    const { schedule, booking, email } = await bookGuest(10, 2);
    expect(await seatsLeft(schedule.id)).toBe(8);

    const res = await api().patch(`/api/v1/bookings/${booking.id}/cancel`).send({ email });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(BookingStatus.CANCELLED);
    expect(await seatsLeft(schedule.id)).toBe(10);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe(PaymentStatus.CANCELED);
  });

  it('400: cancelling twice returns seats only once', async () => {
    const { schedule, booking, email } = await bookGuest(10, 2);

    await api().patch(`/api/v1/bookings/${booking.id}/cancel`).send({ email }).expect(200);
    const second = await api().patch(`/api/v1/bookings/${booking.id}/cancel`).send({ email });

    expect(second.status).toBe(400);
    expect(await seatsLeft(schedule.id)).toBe(10);
  });

  it('two simultaneous cancels: one succeeds, seats restored exactly once', async () => {
    const { schedule, booking, email } = await bookGuest(10, 3);

    const results = await Promise.all(
      [1, 2].map(() => api().patch(`/api/v1/bookings/${booking.id}/cancel`).send({ email })),
    );

    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await seatsLeft(schedule.id)).toBe(10);
  });

  it('404: guest with wrong or missing email cannot cancel (booking not revealed)', async () => {
    const { schedule, booking } = await bookGuest();

    const wrong = await api().patch(`/api/v1/bookings/${booking.id}/cancel`).send({ email: 'someone@else.com' });
    const missing = await api().patch(`/api/v1/bookings/${booking.id}/cancel`).send({});

    expect(wrong.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await seatsLeft(schedule.id)).toBe(8);
  });

  it('403: a signed-in user cannot cancel another user’s account booking; owner can', async () => {
    const { schedule } = await createBookableTrip({ seats: 10 });
    const owner = await createUser(Role.USER);
    const stranger = await createUser(Role.USER);
    // Account booking created directly, so this test doesn't depend on POST linking the user.
    const booking = await prisma.booking.create({
      data: {
        reference: 'BK-OWNED1',
        userId: owner.id,
        scheduleId: schedule.id,
        leadPassengerName: 'Owner',
        leadPassengerEmail: owner.email,
        adultsCount: 1,
        totalAmount: 40,
        status: BookingStatus.CONFIRMED,
      },
    });
    await prisma.schedule.update({ where: { id: schedule.id }, data: { availableSeats: 9 } });

    const byStranger = await api()
      .patch(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${await tokenFor(stranger)}`)
      .send({});
    expect(byStranger.status).toBe(403);
    expect(await seatsLeft(schedule.id)).toBe(9);

    const byOwner = await api()
      .patch(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${await tokenFor(owner)}`)
      .send({});
    expect(byOwner.status).toBe(200);
    expect(await seatsLeft(schedule.id)).toBe(10);
  });
});

describe('Validation (Zod) — 400 with field paths', () => {
  it('missing scheduleId', async () => {
    const { scheduleId: _omit, ...body } = bookingPayload('00000000-0000-4000-8000-000000000000');

    const res = await api().post('/api/v1/bookings').send(body);

    expect(res.status).toBe(400);
    expect(res.body.errorMessages.map((e: { path: string }) => e.path)).toContain('scheduleId');
  });

  it('passenger records must match adults + children', async () => {
    const { schedule } = await createBookableTrip();
    const body = { ...bookingPayload(schedule.id, { adults: 2 }), adultsCount: 3 };

    const res = await api().post('/api/v1/bookings').send(body);

    expect(res.status).toBe(400);
    expect(res.body.errorMessages.map((e: { path: string }) => e.path)).toContain('passengers');
    expect(await seatsLeft(schedule.id)).toBe(10);
  });

  it('adultsCount must be at least 1', async () => {
    const { schedule } = await createBookableTrip();
    const body = { ...bookingPayload(schedule.id), adultsCount: 0 };

    const res = await api().post('/api/v1/bookings').send(body);

    expect(res.status).toBe(400);
    expect(res.body.errorMessages.map((e: { path: string }) => e.path)).toContain('adultsCount');
  });
});

describe('Auth on booking endpoints (live DB status)', () => {
  it('401: /bookings/my without a token', async () => {
    const res = await api().get('/api/v1/bookings/my');
    expect(res.status).toBe(401);
  });

  it('403: suspended user with a still-valid token is blocked', async () => {
    const user = await createUser(Role.USER);
    const token = await tokenFor(user);
    await prisma.user.update({ where: { id: user.id }, data: { status: AccountStatus.SUSPENDED } });

    const res = await api().get('/api/v1/bookings/my').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('401: revoked session is rejected', async () => {
    const user = await createUser(Role.USER);
    const token = await tokenFor(user);
    await prisma.session.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });

    const res = await api().get('/api/v1/bookings/my').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});

describe('Response shape — customer sees no secrets or platform finance', () => {
  it('create response has no credentials, session hashes or commission/payout fields', async () => {
    const { schedule } = await createBookableTrip();

    const res = await api().post('/api/v1/bookings').send(bookingPayload(schedule.id));
    expect(res.status).toBe(201);

    const leaks = findKeysDeep(res.body.data, [
      'passwordHash',
      'refreshTokenHash',
      'tokenHash',
      'platformCommissionCents',
      'operatorPayoutCents',
      'commissionRate',
      'stripePaymentIntentId',
      'transactionId',
    ]);
    expect(leaks).toEqual([]);
    expect(Object.keys(res.body.data.payment).sort()).toEqual(
      ['amountCents', 'currency', 'paidAt', 'refunds', 'status'].sort(),
    );
  });
});
