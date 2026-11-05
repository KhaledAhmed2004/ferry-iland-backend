import { BookingStatus, PaymentStatus, RefundReason, RefundStatus, Role, TripStatus } from '@prisma/client';
import Stripe from 'stripe';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Seat hold expiry against a real Postgres with the Stripe client stubbed (spec 0002, child
 * "seat hold expiry", AC-13 to AC-17, AC-19). The job's tick is called directly; the timer never
 * runs in tests. Run with `npm run test:int`.
 */
const TEST_SECRET = 'whsec_test_hold_expiry';

const { stripeHolder, createIntent, retrieveIntent, cancelIntent, createRefund } = vi.hoisted(() => {
  const createIntent = vi.fn();
  const retrieveIntent = vi.fn();
  const cancelIntent = vi.fn();
  const createRefund = vi.fn();
  return {
    createIntent,
    retrieveIntent,
    cancelIntent,
    createRefund,
    stripeHolder: {
      client: {
        paymentIntents: { create: createIntent, retrieve: retrieveIntent, cancel: cancelIntent },
        refunds: { create: createRefund },
      } as unknown,
    },
  };
});

vi.mock('../../../../config/stripe', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../config/stripe')>()),
  // A getter, so one test can run with no Stripe key configured (AC-17).
  get stripe() {
    return stripeHolder.client;
  },
  stripeConfig: { webhookSecret: 'whsec_test_hold_expiry' },
}));

import app from '../../../../app';
import config from '../../../../config';
import { logger } from '../../../../shared/logger';
import {
  THREE_DS_GRACE_MS,
  expireHolds,
  startHoldExpiryJob,
  sweepPendingRefunds,
  tick,
} from '../holdExpiry.job';
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
const MINUTE = 60_000;

const stripeClient = stripeHolder.client;

const fakeIntent = (overrides: Partial<Stripe.PaymentIntent> = {}) => {
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
    last_payment_error: null,
    ...overrides,
  } as Stripe.PaymentIntent;
};

const unexpectedState = () =>
  new Stripe.errors.StripeInvalidRequestError({
    message: 'You cannot cancel this PaymentIntent because it has a status of succeeded.',
    type: 'invalid_request_error',
    code: 'payment_intent_unexpected_state',
  });

/** A PENDING Stripe booking with a stored PaymentIntent, made through the real endpoints. */
const pendingWithIntent = async (opts: { seats?: number; adults?: number } = {}) => {
  const { schedule } = await createBookableTrip({ seats: opts.seats ?? 10, adultFare: 40 });
  const email = `lead-${uniq()}@test.local`;
  const created = await api()
    .post('/api/v1/bookings')
    .send(bookingPayload(schedule.id, { email, adults: opts.adults ?? 1 }));
  expect(created.status).toBe(201);
  const booking = created.body.data as { id: string; reference: string };

  const intentRes = await api().post('/api/v1/payments/intent').send({ bookingId: booking.id, email });
  expect(intentRes.status).toBe(200);

  const intent = (await createIntent.mock.results.at(-1)!.value) as Stripe.PaymentIntent;
  const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
  const succeeded = { ...intent, status: 'succeeded', amount_received: intent.amount } as Stripe.PaymentIntent;
  return { booking, email, payment, schedule, intent, succeeded };
};

/** Moves the hold end into the past by `msAgo`. */
const endHold = (bookingId: string, msAgo = MINUTE) =>
  prisma.booking.update({
    where: { id: bookingId },
    data: { holdExpiresAt: new Date(Date.now() - msAgo) },
  });

const stateOf = (bookingId: string) =>
  prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { payment: { include: { refunds: true } } },
  });

/** An overdue booking whose intent Stripe reports as `status`. */
const overdueWith = async (status: Stripe.PaymentIntent.Status, msAgo = MINUTE) => {
  const ctx = await pendingWithIntent();
  await endHold(ctx.booking.id, msAgo);
  retrieveIntent.mockResolvedValue({ ...ctx.intent, status });
  return ctx;
};

/** EXPIRED by a real tick, ready for a late success. */
const expiredBooking = async (opts: { seats?: number; adults?: number } = {}) => {
  const ctx = await pendingWithIntent(opts);
  await endHold(ctx.booking.id);
  retrieveIntent.mockResolvedValue(ctx.intent);
  await tick();
  expect((await stateOf(ctx.booking.id)).status).toBe(BookingStatus.EXPIRED);
  retrieveIntent.mockReset();
  return ctx;
};

const postSigned = (type: string, object: unknown) => {
  const payload = JSON.stringify({
    id: `evt_test_${uniq()}`,
    object: 'event',
    api_version: '2026-10-28.endive',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object },
  });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: TEST_SECRET });
  return api()
    .post('/api/v1/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', header)
    .send(payload);
};

let paymentsWereEnabled: boolean;

beforeAll(() => {
  paymentsWereEnabled = config.payments.enabled;
  config.payments.enabled = true;
});

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  stripeHolder.client = stripeClient;
  createIntent.mockImplementation(async (params: Stripe.PaymentIntentCreateParams) =>
    fakeIntent({ amount: params.amount, currency: params.currency, metadata: params.metadata as Stripe.Metadata }),
  );
  cancelIntent.mockImplementation(async (id: string) => fakeIntent({ id, status: 'canceled' }));
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

describe('expiry tick (AC-13)', () => {
  it('expires an overdue hold once: EXPIRED, seats back, payment CANCELED, intent cancelled once', async () => {
    const { booking, payment, schedule, intent } = await overdueWith('requires_payment_method');
    const seatsHeld = await seatsLeft(schedule.id);

    await tick();
    await tick();

    const state = await stateOf(booking.id);
    expect(state.status).toBe(BookingStatus.EXPIRED);
    expect(state.expiredAt).not.toBeNull();
    expect(state.payment!.status).toBe(PaymentStatus.CANCELED);
    expect(await seatsLeft(schedule.id)).toBe(seatsHeld + 1);
    expect(cancelIntent).toHaveBeenCalledTimes(1);
    expect(cancelIntent).toHaveBeenCalledWith(intent.id, {}, { idempotencyKey: `pi-cancel-${payment.id}` });
  });

  it('leaves a hold that has not ended alone', async () => {
    const { booking, schedule } = await pendingWithIntent();
    const seatsHeld = await seatsLeft(schedule.id);

    await tick();

    expect((await stateOf(booking.id)).status).toBe(BookingStatus.PENDING);
    expect(await seatsLeft(schedule.id)).toBe(seatsHeld);
    expect(cancelIntent).not.toHaveBeenCalled();
  });

  it('expires a hold with no intent yet without calling Stripe', async () => {
    const { schedule } = await createBookableTrip({ seats: 10 });
    const created = await api().post('/api/v1/bookings').send(bookingPayload(schedule.id));
    await endHold(created.body.data.id);

    await tick();

    expect((await stateOf(created.body.data.id)).status).toBe(BookingStatus.EXPIRED);
    expect(retrieveIntent).not.toHaveBeenCalled();
    expect(cancelIntent).not.toHaveBeenCalled();
  });

  it('parallel runs return seats exactly once', async () => {
    const { booking, schedule } = await overdueWith('requires_payment_method');
    const seatsHeld = await seatsLeft(schedule.id);

    const runs = await Promise.all([expireHolds(), expireHolds(), expireHolds()]);

    expect(runs.flat().filter(o => o === 'expired')).toHaveLength(1);
    expect(await seatsLeft(schedule.id)).toBe(seatsHeld + 1);
    expect((await stateOf(booking.id)).status).toBe(BookingStatus.EXPIRED);
    expect(cancelIntent).toHaveBeenCalledTimes(1);
  });

  it.each(['requires_action', 'processing'] as const)(
    '3DS grace: intent %s and hold ended under 5 minutes ago → skipped this tick',
    async status => {
      const { booking, schedule } = await overdueWith(status, THREE_DS_GRACE_MS - MINUTE);
      const seatsHeld = await seatsLeft(schedule.id);

      await tick();

      expect((await stateOf(booking.id)).status).toBe(BookingStatus.PENDING);
      expect(await seatsLeft(schedule.id)).toBe(seatsHeld);
      expect(cancelIntent).not.toHaveBeenCalled();
    },
  );

  it('3DS grace ends: intent requires_action and hold ended over 5 minutes ago → expired', async () => {
    const { booking } = await overdueWith('requires_action', THREE_DS_GRACE_MS + MINUTE);

    await tick();

    expect((await stateOf(booking.id)).status).toBe(BookingStatus.EXPIRED);
    expect(cancelIntent).toHaveBeenCalledTimes(1);
  });

  it('an intent that already succeeded is applied instead of expiring the booking', async () => {
    const { booking, schedule, succeeded } = await pendingWithIntent();
    await endHold(booking.id);
    retrieveIntent.mockResolvedValue(succeeded);
    const seatsHeld = await seatsLeft(schedule.id);

    await tick();

    const state = await stateOf(booking.id);
    expect(state.status).toBe(BookingStatus.CONFIRMED);
    expect(state.payment!.status).toBe(PaymentStatus.COMPLETED);
    expect(await seatsLeft(schedule.id)).toBe(seatsHeld);
    expect(cancelIntent).not.toHaveBeenCalled();
  });

  it('a Stripe outage on retrieve still expires the booking', async () => {
    const { booking } = await pendingWithIntent();
    await endHold(booking.id);
    retrieveIntent.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({ message: 'down', type: 'api_error' } as never),
    );

    await tick();

    expect((await stateOf(booking.id)).status).toBe(BookingStatus.EXPIRED);
  });
});

describe('intent cancel fallback (AC-13, AC-14)', () => {
  it('cancel refused because the intent succeeded meanwhile, seats free → booking CONFIRMED again', async () => {
    const { booking, schedule, intent, succeeded } = await overdueWith('requires_payment_method');
    const seatsHeld = await seatsLeft(schedule.id);
    cancelIntent.mockRejectedValue(unexpectedState());
    retrieveIntent.mockResolvedValueOnce(intent).mockResolvedValueOnce(succeeded);

    await tick();

    const state = await stateOf(booking.id);
    expect(state.status).toBe(BookingStatus.CONFIRMED);
    expect(state.confirmedAt).not.toBeNull();
    expect(state.expiredAt).not.toBeNull();
    expect(state.payment!.status).toBe(PaymentStatus.COMPLETED);
    expect(await seatsLeft(schedule.id)).toBe(seatsHeld);
    expect(createRefund).not.toHaveBeenCalled();
  });

  it.each(['canceled', 'processing'] as const)(
    'cancel refused and the intent is %s → nothing more happens',
    async status => {
      const { booking, intent } = await overdueWith('requires_payment_method');
      cancelIntent.mockRejectedValue(unexpectedState());
      retrieveIntent.mockResolvedValueOnce(intent).mockResolvedValueOnce({ ...intent, status });

      await tick();

      const state = await stateOf(booking.id);
      expect(state.status).toBe(BookingStatus.EXPIRED);
      expect(state.payment!.status).toBe(PaymentStatus.CANCELED);
    },
  );

  it('any other Stripe cancel error is logged and the booking stays EXPIRED', async () => {
    const { booking } = await overdueWith('requires_payment_method');
    cancelIntent.mockRejectedValue(
      new Stripe.errors.StripeAPIError({ message: 'boom', type: 'api_error' } as never),
    );
    const errorSpy = vi.spyOn(logger, 'error');

    await tick();

    expect((await stateOf(booking.id)).status).toBe(BookingStatus.EXPIRED);
    expect(errorSpy.mock.calls.some(([msg]) => String(msg).includes('PaymentIntent cancel (expiry) failed'))).toBe(true);
  });
});

describe('late payment for an EXPIRED booking (AC-14)', () => {
  it('seats still free → takes them again: CONFIRMED, payment COMPLETED, no refund', async () => {
    const { booking, schedule, succeeded } = await expiredBooking({ adults: 2 });
    const seatsFree = await seatsLeft(schedule.id);

    const result = await PaymentService.applyIntentResult(succeeded, 'webhook');

    expect(result.outcome).toBe('confirmed');
    const state = await stateOf(booking.id);
    expect(state.status).toBe(BookingStatus.CONFIRMED);
    expect(state.expiredAt).not.toBeNull();
    expect(state.payment!.status).toBe(PaymentStatus.COMPLETED);
    expect(state.payment!.paidAt).not.toBeNull();
    expect(await seatsLeft(schedule.id)).toBe(seatsFree - 2);
  });

  it('seats sold meanwhile → payment COMPLETED, LATE_PAYMENT refund, seats never below 0', async () => {
    createRefund.mockImplementation(async (params: Stripe.RefundCreateParams) => ({
      id: `re_test_${uniq()}`,
      object: 'refund',
      amount: params.amount,
      status: 'succeeded',
    }));
    const { booking, payment, schedule, succeeded } = await expiredBooking({ seats: 2, adults: 2 });
    await prisma.schedule.update({ where: { id: schedule.id }, data: { availableSeats: 1 } });

    const result = await PaymentService.applyIntentResult(succeeded, 'webhook');

    expect(result.outcome).toBe('late_refund');
    const state = await stateOf(booking.id);
    expect(state.status).toBe(BookingStatus.EXPIRED);
    expect(state.payment!.status).toBe(PaymentStatus.REFUNDED);
    expect(state.payment!.refunds).toHaveLength(1);
    expect(state.payment!.refunds[0]).toMatchObject({
      reason: RefundReason.LATE_PAYMENT,
      status: RefundStatus.SUCCEEDED,
      amountCents: payment.amountCents,
      requestedByUserId: null,
    });
    expect(state.payment!.refunds[0].processedAt).not.toBeNull();
    expect(await seatsLeft(schedule.id)).toBe(1);
    expect(createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: succeeded.id, amount: payment.amountCents }),
      { idempotencyKey: `refund-LATE_PAYMENT-${payment.id}` },
    );
  });

  it.each([TripStatus.DEPARTED, TripStatus.CANCELLED])(
    'trip %s before the money arrived → refunded, seats untouched',
    async status => {
      const { booking, schedule, succeeded } = await expiredBooking();
      await prisma.schedule.update({ where: { id: schedule.id }, data: { status } });
      const seatsFree = await seatsLeft(schedule.id);

      const result = await PaymentService.applyIntentResult(succeeded, 'webhook');

      expect(result.outcome).toBe('late_refund');
      expect((await stateOf(booking.id)).status).toBe(BookingStatus.EXPIRED);
      expect(await seatsLeft(schedule.id)).toBe(seatsFree);
    },
  );

  it('departure time already passed (status still open) → refunded', async () => {
    const { booking, schedule, succeeded } = await expiredBooking();
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { departureTime: new Date(Date.now() - MINUTE) },
    });

    const result = await PaymentService.applyIntentResult(succeeded, 'webhook');

    expect(result.outcome).toBe('late_refund');
    expect((await stateOf(booking.id)).payment!.refunds[0].reason).toBe(RefundReason.LATE_PAYMENT);
  });

  it('a repeat call changes nothing: one refund, one Stripe refund call', async () => {
    const { booking, schedule, succeeded } = await expiredBooking();
    await prisma.schedule.update({ where: { id: schedule.id }, data: { availableSeats: 0 } });

    await PaymentService.applyIntentResult(succeeded, 'webhook');
    const repeat = await PaymentService.applyIntentResult(succeeded, 'sync');

    expect(repeat.outcome).toBe('duplicate');
    expect((await stateOf(booking.id)).payment!.refunds).toHaveLength(1);
    expect(createRefund).toHaveBeenCalledTimes(1);
    expect(await seatsLeft(schedule.id)).toBe(0);
  });

  it('two late successes at once take the seats only once', async () => {
    const { schedule, succeeded } = await expiredBooking({ adults: 2 });
    const seatsFree = await seatsLeft(schedule.id);

    const results = await Promise.allSettled([
      PaymentService.applyIntentResult(succeeded, 'webhook'),
      PaymentService.applyIntentResult(succeeded, 'sync'),
    ]);

    const outcomes = results.flatMap(r => (r.status === 'fulfilled' ? [r.value.outcome] : []));
    expect(outcomes.filter(o => o === 'confirmed')).toHaveLength(1);
    expect(await seatsLeft(schedule.id)).toBe(seatsFree - 2);
  });

  it('refund pending at Stripe, then refund.updated succeeded → payment REFUNDED', async () => {
    const { booking, schedule, succeeded } = await expiredBooking();
    await prisma.schedule.update({ where: { id: schedule.id }, data: { availableSeats: 0 } });

    await PaymentService.applyIntentResult(succeeded, 'webhook');
    const pending = (await stateOf(booking.id)).payment!.refunds[0];
    expect(pending.status).toBe(RefundStatus.PENDING);
    expect(pending.stripeRefundId).toMatch(/^re_test_/);

    const res = await postSigned('refund.updated', {
      id: pending.stripeRefundId,
      object: 'refund',
      status: 'succeeded',
      amount: pending.amountCents,
    });

    expect(res.status).toBe(200);
    const state = await stateOf(booking.id);
    expect(state.payment!.refunds[0].status).toBe(RefundStatus.SUCCEEDED);
    expect(state.payment!.status).toBe(PaymentStatus.REFUNDED);
  });
});

describe('refund failure (AC-16)', () => {
  it('Stripe rejects the refund → Refund FAILED with message, payment COMPLETED, error logged with ids, no retry', async () => {
    createRefund.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: 'Charge already refunded',
        type: 'invalid_request_error',
        code: 'charge_already_refunded',
      }),
    );
    const { booking, payment, schedule, succeeded } = await expiredBooking();
    await prisma.schedule.update({ where: { id: schedule.id }, data: { availableSeats: 0 } });
    const errorSpy = vi.spyOn(logger, 'error');

    await PaymentService.applyIntentResult(succeeded, 'webhook');

    const state = await stateOf(booking.id);
    const refund = state.payment!.refunds[0];
    expect(refund.status).toBe(RefundStatus.FAILED);
    expect(refund.failureMessage).toMatch(/^charge_already_refunded: /);
    expect(state.payment!.status).toBe(PaymentStatus.COMPLETED);
    const logged = errorSpy.mock.calls.map(([msg]) => String(msg)).join('\n');
    expect(logged).toContain(refund.id);
    expect(logged).toContain(payment.id);
    expect(logged).toContain(booking.id);

    // A FAILED refund is never resent, even when old.
    await prisma.refund.update({ where: { id: refund.id }, data: { createdAt: new Date(Date.now() - 60 * MINUTE) } });
    await tick();
    expect(createRefund).toHaveBeenCalledTimes(1);
  });

  it('Stripe answers failed → Refund FAILED, payment COMPLETED', async () => {
    createRefund.mockImplementation(async (params: Stripe.RefundCreateParams) => ({
      id: `re_test_${uniq()}`,
      object: 'refund',
      amount: params.amount,
      status: 'failed',
      failure_reason: 'expired_or_canceled_card',
    }));
    const { booking, schedule, succeeded } = await expiredBooking();
    await prisma.schedule.update({ where: { id: schedule.id }, data: { availableSeats: 0 } });

    await PaymentService.applyIntentResult(succeeded, 'webhook');

    const state = await stateOf(booking.id);
    expect(state.payment!.refunds[0]).toMatchObject({
      status: RefundStatus.FAILED,
      failureMessage: 'expired_or_canceled_card',
    });
    expect(state.payment!.status).toBe(PaymentStatus.COMPLETED);
  });
});

describe('customer cancel (AC-15)', () => {
  it('cancelling a PENDING booking cancels its intent after the commit', async () => {
    const { booking, email, payment, intent } = await pendingWithIntent();

    const res = await api().patch(`/api/v1/bookings/${booking.id}/cancel`).send({ email });

    expect(res.status).toBe(200);
    expect(cancelIntent).toHaveBeenCalledWith(intent.id, {}, { idempotencyKey: `pi-cancel-${payment.id}` });
    const state = await stateOf(booking.id);
    expect(state.status).toBe(BookingStatus.CANCELLED);
    expect(state.payment!.status).toBe(PaymentStatus.CANCELED);
  });

  it('paid while cancelling (cancel refused, intent succeeded) → stays CANCELLED, CUSTOMER_CANCEL refund', async () => {
    const { booking, email, payment, succeeded } = await pendingWithIntent();
    cancelIntent.mockRejectedValue(unexpectedState());
    retrieveIntent.mockResolvedValue(succeeded);

    const res = await api().patch(`/api/v1/bookings/${booking.id}/cancel`).send({ email });

    expect(res.status).toBe(200);
    const state = await stateOf(booking.id);
    expect(state.status).toBe(BookingStatus.CANCELLED);
    expect(state.payment!.status).toBe(PaymentStatus.COMPLETED);
    expect(state.payment!.refunds).toHaveLength(1);
    expect(state.payment!.refunds[0]).toMatchObject({
      reason: RefundReason.CUSTOMER_CANCEL,
      amountCents: payment.amountCents,
    });
  });

  it('a success webhook after a customer cancel refunds in full and never brings the booking back', async () => {
    const { booking, email, schedule, succeeded } = await pendingWithIntent();
    await api().patch(`/api/v1/bookings/${booking.id}/cancel`).send({ email }).expect(200);
    const seatsAfterCancel = await seatsLeft(schedule.id);

    const result = await PaymentService.applyIntentResult(succeeded, 'webhook');

    expect(result.outcome).toBe('late_refund');
    const state = await stateOf(booking.id);
    expect(state.status).toBe(BookingStatus.CANCELLED);
    expect(state.payment!.refunds[0].reason).toBe(RefundReason.CUSTOMER_CANCEL);
    expect(await seatsLeft(schedule.id)).toBe(seatsAfterCancel);
  });

  it('409 for a customer cancelling a paid booking; nothing changes', async () => {
    const { booking, email, schedule, succeeded } = await pendingWithIntent();
    await PaymentService.applyIntentResult(succeeded, 'webhook');
    const seatsBefore = await seatsLeft(schedule.id);

    const res = await api().patch(`/api/v1/bookings/${booking.id}/cancel`).send({ email });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Contact support to cancel a paid booking');
    const state = await stateOf(booking.id);
    expect(state.status).toBe(BookingStatus.CONFIRMED);
    expect(state.payment!.status).toBe(PaymentStatus.COMPLETED);
    expect(await seatsLeft(schedule.id)).toBe(seatsBefore);
    expect(cancelIntent).not.toHaveBeenCalled();
  });

  it('an admin may still cancel a paid booking', async () => {
    const { booking, succeeded } = await pendingWithIntent();
    await PaymentService.applyIntentResult(succeeded, 'webhook');
    const admin = await createUser(Role.ADMIN);

    const res = await api()
      .patch(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${await tokenFor(admin)}`)
      .send({});

    expect(res.status).toBe(200);
    expect((await stateOf(booking.id)).status).toBe(BookingStatus.CANCELLED);
  });
});

describe('pending refund sweep (AC-19)', () => {
  const stuckRefund = async (ageMs: number) => {
    const { booking, payment, schedule, succeeded } = await expiredBooking();
    await prisma.schedule.update({ where: { id: schedule.id }, data: { availableSeats: 0 } });
    // A crash between the commit and the Stripe call: the refund row exists, no Stripe id.
    createRefund.mockRejectedValueOnce(new Error('process stopped'));
    await PaymentService.applyIntentResult(succeeded, 'webhook');
    const refund = (await stateOf(booking.id)).payment!.refunds[0];
    expect(refund).toMatchObject({ status: RefundStatus.PENDING, stripeRefundId: null });
    await prisma.refund.update({ where: { id: refund.id }, data: { createdAt: new Date(Date.now() - ageMs) } });
    createRefund.mockClear();
    return { refund, payment };
  };

  it('resends a refund stuck PENDING for over 5 minutes with the same idempotency key', async () => {
    const { refund, payment } = await stuckRefund(10 * MINUTE);

    await tick();

    expect(createRefund).toHaveBeenCalledTimes(1);
    expect(createRefund.mock.calls[0][1]).toEqual({ idempotencyKey: `refund-LATE_PAYMENT-${payment.id}` });
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).stripeRefundId).toMatch(/^re_test_/);
  });

  it('leaves a refund younger than 5 minutes for later', async () => {
    await stuckRefund(MINUTE);

    expect(await sweepPendingRefunds()).toEqual([]);
    expect(createRefund).not.toHaveBeenCalled();
  });
});

describe('job switch and missing key (AC-17)', () => {
  it('without STRIPE_SECRET_KEY the tick still expires holds and skips Stripe calls', async () => {
    const { booking, schedule } = await pendingWithIntent();
    await endHold(booking.id);
    const seatsHeld = await seatsLeft(schedule.id);
    stripeHolder.client = null;

    await tick();

    expect((await stateOf(booking.id)).status).toBe(BookingStatus.EXPIRED);
    expect(await seatsLeft(schedule.id)).toBe(seatsHeld + 1);
    expect(retrieveIntent).not.toHaveBeenCalled();
    expect(cancelIntent).not.toHaveBeenCalled();
  });

  it('expires holds even with PAYMENTS_ENABLED off', async () => {
    const { booking } = await overdueWith('requires_payment_method');
    config.payments.enabled = false;
    try {
      await tick();
    } finally {
      config.payments.enabled = true;
    }
    expect((await stateOf(booking.id)).status).toBe(BookingStatus.EXPIRED);
  });

  it('does not start under NODE_ENV=test, starts in any other environment', () => {
    const nodeEnv = config.node_env;
    try {
      expect(startHoldExpiryJob()).toBeNull();
      config.node_env = 'production';
      const timer = startHoldExpiryJob();
      expect(timer).not.toBeNull();
      clearInterval(timer!);
    } finally {
      config.node_env = nodeEnv;
    }
  });
});
