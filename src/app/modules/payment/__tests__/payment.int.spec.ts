import { BookingStatus, PaymentProvider, PaymentStatus, Role } from '@prisma/client';
import Stripe from 'stripe';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/v1/payments/intent and /payments/:bookingId/sync against a real Postgres with the
 * Stripe client stubbed (spec 0002, AC-1, AC-2, AC-12). Run with `npm run test:int`.
 */
// Kept as separate handles: the app's tracing patch (logging/patchStripe.ts) wraps the
// methods on the client object, so the test must hold the original spies.
const { createIntent, retrieveIntent, createRefund } = vi.hoisted(() => ({
  createIntent: vi.fn(),
  retrieveIntent: vi.fn(),
  createRefund: vi.fn(),
}));

vi.mock('../../../../config/stripe', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../config/stripe')>()),
  stripe: {
    paymentIntents: { create: createIntent, retrieve: retrieveIntent },
    refunds: { create: createRefund },
  },
}));

import app from '../../../../app';
import config from '../../../../config';
import { PaymentService } from '../payment.service';
import {
  bookingPayload,
  createBookableTrip,
  createUser,
  prisma,
  resetDb,
  seatsLeft,
  tokenFor,
  uniq,
} from '../../../../../test/integration/helpers';

const api = () => request(app);

type FakeIntent = Partial<Stripe.PaymentIntent> & { id: string };

const fakeIntent = (overrides: Partial<Stripe.PaymentIntent> = {}): FakeIntent => {
  const id = `pi_test_${uniq()}`;
  return {
    id,
    object: 'payment_intent',
    status: 'requires_payment_method',
    client_secret: `${id}_secret_${uniq()}`,
    amount: 4000,
    amount_received: 0,
    currency: 'usd',
    livemode: false,
    metadata: {},
    ...overrides,
  };
};

/** Echo the create params back as the intent, the way Stripe does. */
const stubCreateEcho = () => {
  createIntent.mockImplementation(
    async (params: Stripe.PaymentIntentCreateParams) =>
      fakeIntent({
        amount: params.amount,
        currency: params.currency,
        metadata: params.metadata as Stripe.Metadata,
      }),
  );
};

/** A PENDING Stripe booking, made through the real create endpoint with payments on. */
const createPendingBooking = async (
  opts: { email?: string; token?: string; adultFare?: number } = {},
) => {
  const { schedule } = await createBookableTrip({ seats: 10, adultFare: opts.adultFare ?? 40 });
  const email = opts.email ?? `lead-${uniq()}@test.local`;
  const req = api().post('/api/v1/bookings');
  if (opts.token) req.set('Authorization', `Bearer ${opts.token}`);
  const res = await req.send(bookingPayload(schedule.id, { email }));
  expect(res.status).toBe(201);
  expect(res.body.data.status).toBe(BookingStatus.PENDING);
  return { booking: res.body.data as { id: string; reference: string }, email, schedule };
};

const postIntent = (body: Record<string, unknown>, token?: string) => {
  const req = api().post('/api/v1/payments/intent');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(body);
};

let paymentsWereEnabled: boolean;

beforeAll(() => {
  paymentsWereEnabled = config.payments.enabled;
  config.payments.enabled = true;
});

beforeEach(async () => {
  await resetDb();
  vi.resetAllMocks();
  stubCreateEcho();
  createRefund.mockImplementation(async (params: Stripe.RefundCreateParams) => ({
    id: `re_test_${uniq()}`,
    object: 'refund',
    amount: params.amount,
    status: 'pending',
  }));
});

afterAll(async () => {
  config.payments.enabled = paymentsWereEnabled;
  await prisma.$disconnect();
});

describe('POST /api/v1/payments/intent: create (AC-1)', () => {
  it('200: creates one card only intent for the stored amount and saves its id', async () => {
    const { booking, email } = await createPendingBooking({ adultFare: 40 });

    const res = await postIntent({ bookingId: booking.id, email, amountCents: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      bookingId: booking.id,
      bookingReference: booking.reference,
      amountCents: 4000,
      currency: 'usd',
    });
    expect(res.body.data.clientSecret).toMatch(/_secret_/);
    expect(new Date(res.body.data.holdExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(Math.abs(new Date(res.body.data.serverNow).getTime() - Date.now())).toBeLessThan(10_000);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(createIntent).toHaveBeenCalledTimes(1);
    const [params, options] = createIntent.mock.calls[0];
    expect(params, 'amount must come from the Payment row, never the request').toMatchObject({
      amount: 4000,
      currency: 'usd',
      allowed_payment_method_types: ['card'],
      metadata: { bookingId: booking.id, paymentId: payment.id, bookingReference: booking.reference },
    });
    expect(params).not.toHaveProperty('payment_method_types');
    expect(options).toEqual({ idempotencyKey: `pi-create-${payment.id}` });

    const createdIntent = await createIntent.mock.results[0].value;
    expect(payment.stripePaymentIntentId).toBe(createdIntent.id);
  });

  it('200: a second call returns the same intent and creates no new one', async () => {
    const { booking, email } = await createPendingBooking();
    const first = await postIntent({ bookingId: booking.id, email });
    const created = await createIntent.mock.results[0].value;
    retrieveIntent.mockResolvedValue(created);

    const second = await postIntent({ bookingId: booking.id, email });

    expect(second.status).toBe(200);
    expect(second.body.data.clientSecret).toBe(first.body.data.clientSecret);
    expect(createIntent).toHaveBeenCalledTimes(1);
    expect(retrieveIntent).toHaveBeenCalledWith(created.id);
  });

  it('409 PAYMENT_PROCESSING: the stored intent is processing', async () => {
    const { booking, email } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    const created = await createIntent.mock.results[0].value;
    retrieveIntent.mockResolvedValue({ ...created, status: 'processing' });

    const res = await postIntent({ bookingId: booking.id, email });

    expect(res.status).toBe(409);
    expect(res.body.data).toMatchObject({ code: 'PAYMENT_PROCESSING', bookingStatus: 'PENDING' });
  });

  it('409 HOLD_EXPIRED: the stored intent was canceled in Stripe', async () => {
    const { booking, email } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    const created = await createIntent.mock.results[0].value;
    retrieveIntent.mockResolvedValue({ ...created, status: 'canceled' });

    const res = await postIntent({ bookingId: booking.id, email });

    expect(res.status).toBe(409);
    expect(res.body.data.code).toBe('HOLD_EXPIRED');
  });

  it('409 PAYMENT_SUCCEEDED: a succeeded stored intent is applied and the booking confirmed', async () => {
    const { booking, email, schedule } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    const created = await createIntent.mock.results[0].value;
    retrieveIntent.mockResolvedValue({
      ...created,
      status: 'succeeded',
      amount_received: created.amount,
    });

    const res = await postIntent({ bookingId: booking.id, email });

    expect(res.status).toBe(409);
    expect(res.body.data).toMatchObject({ code: 'PAYMENT_SUCCEEDED', bookingStatus: 'CONFIRMED' });
    const saved = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { payment: true },
    });
    expect(saved.status).toBe(BookingStatus.CONFIRMED);
    expect(saved.confirmedAt).not.toBeNull();
    expect(saved.payment).toMatchObject({ status: PaymentStatus.COMPLETED, paymentMethod: 'card' });
    expect(saved.payment?.paidAt).not.toBeNull();
    expect(await seatsLeft(schedule.id), 'confirming takes no extra seats').toBe(9);
  });

  it('502: Stripe unreachable keeps the hold and saves no intent id', async () => {
    const { booking, email } = await createPendingBooking();
    createIntent.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({ message: 'network down' } as never),
    );

    const res = await postIntent({ bookingId: booking.id, email });

    expect(res.status).toBe(502);
    expect(res.body.message).toBe('Payment service unavailable, try again');
    const saved = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { payment: true },
    });
    expect(saved.status).toBe(BookingStatus.PENDING);
    expect(saved.payment?.stripePaymentIntentId).toBeNull();
  });
});

describe('POST /api/v1/payments/intent: access and status errors (AC-2)', () => {
  it('404: a guest with no email or a wrong email learns nothing', async () => {
    const { booking } = await createPendingBooking();

    expect((await postIntent({ bookingId: booking.id })).status).toBe(404);
    expect((await postIntent({ bookingId: booking.id, email: 'someone@else.test' })).status).toBe(404);
    expect(createIntent).not.toHaveBeenCalled();
  });

  it('200: the guest email matches trimmed and case insensitive', async () => {
    const { booking, email } = await createPendingBooking();

    const res = await postIntent({ bookingId: booking.id, email: `  ${email.toUpperCase()} ` });

    expect(res.status).toBe(200);
  });

  it('404: unknown booking', async () => {
    const res = await postIntent({ bookingId: '00000000-0000-4000-8000-000000000000', email: 'a@b.c' });
    expect(res.status).toBe(404);
  });

  it('403: a signed in user asking for another account booking', async () => {
    const owner = await createUser(Role.USER);
    const other = await createUser(Role.USER);
    const { booking } = await createPendingBooking({ email: owner.email, token: await tokenFor(owner) });

    const res = await postIntent({ bookingId: booking.id }, await tokenFor(other));

    expect(res.status).toBe(403);
  });

  it('200: the owner and an admin may pay without an email', async () => {
    const owner = await createUser(Role.USER);
    const admin = await createUser(Role.ADMIN);
    const { booking } = await createPendingBooking({ email: owner.email, token: await tokenFor(owner) });

    expect((await postIntent({ bookingId: booking.id }, await tokenFor(owner))).status).toBe(200);
    retrieveIntent.mockResolvedValue(await createIntent.mock.results[0].value);
    expect((await postIntent({ bookingId: booking.id }, await tokenFor(admin))).status).toBe(200);
  });

  it('400: a payment that is not provider STRIPE', async () => {
    const { booking, email } = await createPendingBooking();
    await prisma.payment.update({
      where: { bookingId: booking.id },
      data: { provider: PaymentProvider.MANUAL },
    });

    expect((await postIntent({ bookingId: booking.id, email })).status).toBe(400);
  });

  it('400: an amount below 50 cents', async () => {
    const { booking, email } = await createPendingBooking();
    await prisma.payment.update({ where: { bookingId: booking.id }, data: { amountCents: 49 } });

    expect((await postIntent({ bookingId: booking.id, email })).status).toBe(400);
  });

  it('404 beats 400: a wrong email on a non Stripe payment still answers 404', async () => {
    const { booking } = await createPendingBooking();
    await prisma.payment.update({
      where: { bookingId: booking.id },
      data: { provider: PaymentProvider.MANUAL },
    });

    expect((await postIntent({ bookingId: booking.id, email: 'wrong@x.test' })).status).toBe(404);
  });

  it('409 BOOKING_NOT_PENDING: a cancelled booking', async () => {
    const { booking, email } = await createPendingBooking();
    await prisma.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.CANCELLED } });

    const res = await postIntent({ bookingId: booking.id, email });

    expect(res.status).toBe(409);
    expect(res.body.data).toMatchObject({ code: 'BOOKING_NOT_PENDING', bookingStatus: 'CANCELLED' });
  });

  it('409 HOLD_EXPIRED: the hold has passed', async () => {
    const { booking, email } = await createPendingBooking();
    await prisma.booking.update({
      where: { id: booking.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });

    const res = await postIntent({ bookingId: booking.id, email });

    expect(res.status).toBe(409);
    expect(res.body.data.code).toBe('HOLD_EXPIRED');
    expect(createIntent).not.toHaveBeenCalled();
  });

  it('429: more than 20 calls a minute for one booking from one IP', async () => {
    const { booking, email } = await createPendingBooking();
    const created = fakeIntent({ amount: 4000 });
    createIntent.mockResolvedValue(created);
    retrieveIntent.mockResolvedValue(created);

    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push((await postIntent({ bookingId: booking.id, email })).status);
    }

    expect(statuses.slice(0, 20).every(s => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe('POST /api/v1/payments/:bookingId/sync (AC-12)', () => {
  it('confirms a booking whose intent succeeded, once', async () => {
    const { booking, email } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    const created = await createIntent.mock.results[0].value;
    retrieveIntent.mockResolvedValue({
      ...created,
      status: 'succeeded',
      amount_received: created.amount,
    });

    const res = await api().post(`/api/v1/payments/${booking.id}/sync`).send({ email });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(BookingStatus.CONFIRMED);
    expect(res.body.data.payment).toMatchObject({ status: PaymentStatus.COMPLETED });
    expect(res.body.data.payment, 'customer view hides the intent id').not.toHaveProperty(
      'stripePaymentIntentId',
    );

    const again = await api().post(`/api/v1/payments/${booking.id}/sync`).send({ email });
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe(BookingStatus.CONFIRMED);
    expect(retrieveIntent, 'a completed payment is not asked again').toHaveBeenCalledTimes(1);
  });

  it('does not confirm when the amount received differs', async () => {
    const { booking, email } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    const created = await createIntent.mock.results[0].value;
    retrieveIntent.mockResolvedValue({
      ...created,
      status: 'succeeded',
      amount_received: created.amount - 1,
    });

    const res = await api().post(`/api/v1/payments/${booking.id}/sync`).send({ email });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(BookingStatus.PENDING);
  });

  it('leaves a pending booking pending while the intent waits for a card', async () => {
    const { booking, email } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    const created = await createIntent.mock.results[0].value;
    retrieveIntent.mockResolvedValue(created);

    const res = await api().post(`/api/v1/payments/${booking.id}/sync`).send({ email });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(BookingStatus.PENDING);
  });

  it('returns the booking unchanged when Stripe cannot be reached', async () => {
    const { booking, email } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    retrieveIntent.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({ message: 'network down' } as never),
    );

    const res = await api().post(`/api/v1/payments/${booking.id}/sync`).send({ email });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(BookingStatus.PENDING);
  });

  it('404 for a wrong guest email, 403 for another account', async () => {
    const owner = await createUser(Role.USER);
    const other = await createUser(Role.USER);
    const { booking } = await createPendingBooking({ email: owner.email, token: await tokenFor(owner) });

    expect(
      (await api().post(`/api/v1/payments/${booking.id}/sync`).send({ email: 'x@y.test' })).status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/payments/${booking.id}/sync`)
          .set('Authorization', `Bearer ${await tokenFor(other)}`)
          .send({})
      ).status,
    ).toBe(403);
  });
});

describe('POST /api/v1/payments/intent: more errors and leaks (AC-1, AC-2)', () => {
  it('502: Stripe unreachable on a repeat call keeps the stored intent', async () => {
    const { booking, email } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    const created = await createIntent.mock.results[0].value;
    retrieveIntent.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({ message: 'network down' } as never),
    );

    const res = await postIntent({ bookingId: booking.id, email });

    expect(res.status).toBe(502);
    const saved = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(saved.stripePaymentIntentId).toBe(created.id);
  });

  it('404 for a wrong email reveals no reference, status or secret', async () => {
    const { booking } = await createPendingBooking();

    const res = await postIntent({ bookingId: booking.id, email: 'wrong@x.test' });

    expect(res.status).toBe(404);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(booking.reference);
    expect(text).not.toMatch(/PENDING|clientSecret|_secret_/);
  });

  it('a 409 carries only the code, status and reference, never a client secret', async () => {
    const { booking, email } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    const created = await createIntent.mock.results[0].value;
    retrieveIntent.mockResolvedValue({ ...created, status: 'processing' });

    const res = await postIntent({ bookingId: booking.id, email });

    expect(res.status).toBe(409);
    expect(Object.keys(res.body.data).sort()).toEqual(['bookingReference', 'bookingStatus', 'code']);
    expect(JSON.stringify(res.body)).not.toContain('_secret_');
  });
});

describe('POST /api/v1/payments/intent: review follow ups (AC-1, AC-2)', () => {
  it('concurrent first calls all get the one intent Stripe returns for the shared key', async () => {
    const { booking, email } = await createPendingBooking();
    // Stripe's idempotency: the same key always yields the same intent.
    const byKey = new Map<string, FakeIntent>();
    createIntent.mockImplementation(
      async (params: Stripe.PaymentIntentCreateParams, opts: { idempotencyKey: string }) => {
        if (!byKey.has(opts.idempotencyKey)) {
          byKey.set(
            opts.idempotencyKey,
            fakeIntent({ amount: params.amount, metadata: params.metadata as Stripe.Metadata }),
          );
        }
        return byKey.get(opts.idempotencyKey);
      },
    );

    const results = await Promise.all(
      [1, 2, 3].map(() => postIntent({ bookingId: booking.id, email })),
    );

    expect(results.map(r => r.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map(r => r.body.data.clientSecret)).size).toBe(1);
    const saved = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(saved.stripePaymentIntentId).toBe([...byKey.values()][0].id);
  });

  it('a succeeded intent is applied even when the hold has just run out', async () => {
    const { booking, email } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    const created = await createIntent.mock.results[0].value;
    await prisma.booking.update({
      where: { id: booking.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    retrieveIntent.mockResolvedValue({ ...created, status: 'succeeded', amount_received: created.amount });

    const res = await postIntent({ bookingId: booking.id, email });

    expect(res.status).toBe(409);
    expect(res.body.data).toMatchObject({ code: 'PAYMENT_SUCCEEDED', bookingStatus: 'CONFIRMED' });
  });

  it('409 HOLD_EXPIRED: a stored but unpaid intent after the hold ran out', async () => {
    const { booking, email } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    retrieveIntent.mockResolvedValue(await createIntent.mock.results[0].value);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });

    const res = await postIntent({ bookingId: booking.id, email });

    expect(res.status).toBe(409);
    expect(res.body.data.code).toBe('HOLD_EXPIRED');
  });

  it('never claims PAYMENT_SUCCEEDED when the succeeded intent could not be applied', async () => {
    const { booking, email } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    const created = await createIntent.mock.results[0].value;
    retrieveIntent.mockResolvedValue({
      ...created,
      status: 'succeeded',
      amount_received: created.amount - 1,
    });

    const res = await postIntent({ bookingId: booking.id, email });

    expect(res.status).toBe(409);
    expect(res.body.data).toMatchObject({ code: 'PAYMENT_PROCESSING', bookingStatus: 'PENDING' });
  });

  it('502 when Stripe returns an intent without a client secret', async () => {
    const { booking, email } = await createPendingBooking();
    createIntent.mockResolvedValue(fakeIntent({ amount: 4000, client_secret: null }));

    const res = await postIntent({ bookingId: booking.id, email });

    expect(res.status).toBe(502);
  });

  it('401 for an invalid bearer token, not a silent guest checkout', async () => {
    const { booking, email } = await createPendingBooking();

    const res = await postIntent({ bookingId: booking.id, email }, 'not-a-real-token');

    expect(res.status).toBe(401);
    expect(createIntent).not.toHaveBeenCalled();
  });

  it('ids that are not UUIDs share one rate limit bucket per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push((await postIntent({ bookingId: `junk-${uniq()}-${'x'.repeat(200)}` })).status);
    }

    expect(statuses.slice(0, 20).every(s => s === 400)).toBe(true);
    expect(statuses[20], 'random ids must not get a fresh bucket each').toBe(429);
  });
});

describe('POST /api/v1/payments/:bookingId/sync: views and skips (AC-12)', () => {
  it('an admin gets the admin payment view', async () => {
    const admin = await createUser(Role.ADMIN);
    const { booking, email } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    retrieveIntent.mockResolvedValue(await createIntent.mock.results[0].value);

    const res = await api()
      .post(`/api/v1/payments/${booking.id}/sync`)
      .set('Authorization', `Bearer ${await tokenFor(admin)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.payment.stripePaymentIntentId).toMatch(/^pi_test_/);
  });

  it('never calls Stripe for a payment that is not provider STRIPE', async () => {
    const { booking, email } = await createPendingBooking();
    await prisma.payment.update({
      where: { bookingId: booking.id },
      data: { provider: PaymentProvider.MANUAL, stripePaymentIntentId: 'pi_not_ours' },
    });

    const res = await api().post(`/api/v1/payments/${booking.id}/sync`).send({ email });

    expect(res.status).toBe(200);
    expect(retrieveIntent).not.toHaveBeenCalled();
  });

  it('never calls Stripe before an intent exists', async () => {
    const { booking, email } = await createPendingBooking();

    const res = await api().post(`/api/v1/payments/${booking.id}/sync`).send({ email });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(BookingStatus.PENDING);
    expect(retrieveIntent).not.toHaveBeenCalled();
  });
});

/**
 * PaymentService.applyIntentResult: the one write path that marks a STRIPE payment paid
 * (spec 0002, index contract). Built so far: duplicate guard, amount guard, PENDING → CONFIRMED.
 */
describe('PaymentService.applyIntentResult', () => {
  /** A PENDING booking with its intent created and stored; returns that intent as succeeded. */
  const pendingWithSucceededIntent = async () => {
    const { booking, email, schedule } = await createPendingBooking();
    await postIntent({ bookingId: booking.id, email });
    const created = (await createIntent.mock.results[0].value) as Stripe.PaymentIntent;
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    const succeeded = {
      ...created,
      status: 'succeeded',
      amount_received: created.amount,
    } as Stripe.PaymentIntent;
    return { booking, payment, schedule, succeeded };
  };

  const stateOf = (bookingId: string) =>
    prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { payment: true } });

  it('confirms a PENDING booking and completes its payment', async () => {
    const { booking, payment, succeeded } = await pendingWithSucceededIntent();

    const result = await PaymentService.applyIntentResult(succeeded, 'webhook');

    expect(result).toEqual({ outcome: 'confirmed', paymentId: payment.id, bookingId: booking.id });
    const saved = await stateOf(booking.id);
    expect(saved.status).toBe(BookingStatus.CONFIRMED);
    expect(saved.confirmedAt).not.toBeNull();
    expect(saved.payment).toMatchObject({
      status: PaymentStatus.COMPLETED,
      paymentMethod: 'card',
      lastFailureCode: null,
      lastFailureMessage: null,
    });
    expect(saved.payment?.paidAt).not.toBeNull();
  });

  it('clears an earlier decline when the payment succeeds', async () => {
    const { booking, payment, succeeded } = await pendingWithSucceededIntent();
    await prisma.payment.update({
      where: { id: payment.id },
      data: { lastFailureCode: 'card_declined', lastFailureMessage: 'Your card was declined.' },
    });

    await PaymentService.applyIntentResult(succeeded, 'sync');

    const saved = await stateOf(booking.id);
    expect(saved.payment).toMatchObject({ lastFailureCode: null, lastFailureMessage: null });
  });

  it('a repeat call is a duplicate and changes nothing', async () => {
    const { booking, succeeded } = await pendingWithSucceededIntent();
    await PaymentService.applyIntentResult(succeeded, 'webhook');
    const first = await stateOf(booking.id);

    const again = await PaymentService.applyIntentResult(succeeded, 'sync');

    expect(again.outcome).toBe('duplicate');
    const second = await stateOf(booking.id);
    expect(second.confirmedAt).toEqual(first.confirmedAt);
    expect(second.payment?.paidAt).toEqual(first.payment?.paidAt);
  });

  it('two callers at the same moment: exactly one confirms, seats are not taken again', async () => {
    const { booking, schedule, succeeded } = await pendingWithSucceededIntent();
    const seatsBefore = await seatsLeft(schedule.id);

    const outcomes = await Promise.all([
      PaymentService.applyIntentResult(succeeded, 'webhook'),
      PaymentService.applyIntentResult(succeeded, 'sync'),
    ]);

    expect(outcomes.map(o => o.outcome).sort()).toEqual(['confirmed', 'duplicate']);
    expect((await stateOf(booking.id)).status).toBe(BookingStatus.CONFIRMED);
    expect(await seatsLeft(schedule.id)).toBe(seatsBefore);
  });

  it('matches by metadata.paymentId when no intent id is stored yet, then saves it', async () => {
    const { booking } = await createPendingBooking();
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    const intent = fakeIntent({
      status: 'succeeded',
      amount: payment.amountCents,
      amount_received: payment.amountCents,
      metadata: { paymentId: payment.id },
    }) as Stripe.PaymentIntent;

    const result = await PaymentService.applyIntentResult(intent, 'webhook');

    expect(result.outcome).toBe('confirmed');
    const saved = await stateOf(booking.id);
    expect(saved.payment?.stripePaymentIntentId).toBe(intent.id);
  });

  it('refuses an intent whose metadata points at a payment holding a different intent', async () => {
    const { booking, payment, succeeded } = await pendingWithSucceededIntent();
    const stranger = {
      ...succeeded,
      id: `pi_other_${uniq()}`,
      metadata: { paymentId: payment.id },
    } as Stripe.PaymentIntent;

    const result = await PaymentService.applyIntentResult(stranger, 'webhook');

    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/^intent_mismatch/);
    expect((await stateOf(booking.id)).status).toBe(BookingStatus.PENDING);
  });

  it('reports an intent with no matching payment', async () => {
    const intent = fakeIntent({ status: 'succeeded', amount_received: 4000 }) as Stripe.PaymentIntent;

    const result = await PaymentService.applyIntentResult(intent, 'webhook');

    expect(result).toMatchObject({ outcome: 'error', paymentId: null, bookingId: null });
    expect(result.error).toMatch(/^unknown_payment/);
  });

  it('refuses a live mode intent while running on a test key', async () => {
    const { booking, succeeded } = await pendingWithSucceededIntent();

    const result = await PaymentService.applyIntentResult(
      { ...succeeded, livemode: true } as Stripe.PaymentIntent,
      'webhook',
    );

    expect(result.error).toMatch(/^livemode_mismatch/);
    expect((await stateOf(booking.id)).status).toBe(BookingStatus.PENDING);
  });

  it('does nothing for an intent that has not succeeded', async () => {
    const { booking, succeeded } = await pendingWithSucceededIntent();

    const result = await PaymentService.applyIntentResult(
      { ...succeeded, status: 'requires_payment_method', amount_received: 0 } as Stripe.PaymentIntent,
      'sync',
    );

    expect(result.outcome).toBe('not_succeeded');
    expect((await stateOf(booking.id)).payment?.status).toBe(PaymentStatus.PENDING);
  });

  it.each([
    ['one cent short', -1, 'usd'],
    ['one cent over', 1, 'usd'],
    ['in another currency', 0, 'eur'],
  ])('does not confirm when the money received is %s', async (_label, amountDelta, currency) => {
    const { booking, succeeded } = await pendingWithSucceededIntent();

    const result = await PaymentService.applyIntentResult(
      {
        ...succeeded,
        amount_received: (succeeded.amount_received as number) + (amountDelta as number),
        currency: currency as string,
      } as Stripe.PaymentIntent,
      'webhook',
    );

    expect(result.error).toMatch(/^amount_mismatch: expected \d+ usd got \d+ (usd|eur)$/);
    const saved = await stateOf(booking.id);
    expect(saved.status, 'booking is never confirmed on a mismatch (AC-9)').toBe(BookingStatus.PENDING);
    // AC-18: the money really arrived, so the payment completes and is refunded in full.
    expect(saved.payment?.status).toBe(PaymentStatus.COMPLETED);
    const refunds = await prisma.refund.findMany({ where: { paymentId: saved.payment!.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      reason: 'ADMIN',
      amountCents: (succeeded.amount_received as number) + (amountDelta as number),
      stripeRefundId: expect.stringMatching(/^re_test_/),
    });
    expect(createRefund).toHaveBeenCalledTimes(1);
    expect(createRefund.mock.calls[0][1]).toEqual({
      idempotencyKey: `refund-ADMIN-${saved.payment!.id}`,
    });
  });
});
