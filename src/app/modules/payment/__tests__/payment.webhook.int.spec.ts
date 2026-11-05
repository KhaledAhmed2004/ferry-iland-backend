import { BookingStatus, PaymentStatus, Prisma, RefundReason, RefundStatus } from '@prisma/client';
import Stripe from 'stripe';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/v1/payments/webhook against a real Postgres, with real Stripe signatures and the
 * Stripe API client stubbed (spec 0002, child "payment confirmation webhook", AC-7 to AC-11,
 * AC-18). The sync endpoint (AC-12) is covered in payment.int.spec.ts. Run with `npm run test:int`.
 */
const TEST_SECRET = 'whsec_test_webhook_secret';

const { createIntent, retrieveIntent, createRefund, applyRefundStatusSpy, realApply } = vi.hoisted(
  () => ({
    createIntent: vi.fn(),
    retrieveIntent: vi.fn(),
    createRefund: vi.fn(),
    applyRefundStatusSpy: vi.fn(),
    realApply: { fn: undefined as unknown as (...args: unknown[]) => unknown },
  }),
);

vi.mock('../../../../config/stripe', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../config/stripe')>()),
  stripe: {
    paymentIntents: { create: createIntent, retrieve: retrieveIntent },
    refunds: { create: createRefund },
  },
  stripeConfig: { webhookSecret: 'whsec_test_webhook_secret' },
}));

// Lets one test make a handler throw once, to prove the 500 and retry path (AC-11).
vi.mock('../payment.refund', async importOriginal => {
  const original = await importOriginal<typeof import('../payment.refund')>();
  realApply.fn = original.applyRefundStatus as (...args: unknown[]) => unknown;
  return { ...original, applyRefundStatus: applyRefundStatusSpy };
});

import app from '../../../../app';
import config from '../../../../config';
import { stripeConfig } from '../../../../config/stripe';
import { logger } from '../../../../shared/logger';
import {
  bookingPayload,
  createBookableTrip,
  prisma,
  resetDb,
  seatsLeft,
  uniq,
} from '../../../../../test/integration/helpers';

const WEBHOOK = '/api/v1/payments/webhook';
const api = () => request(app);

type EventInput = { type: string; object: unknown; livemode?: boolean; id?: string };

const makeEvent = ({ type, object, livemode = false, id = `evt_test_${uniq()}` }: EventInput) => ({
  id,
  object: 'event',
  api_version: '2026-10-28.endive',
  created: Math.floor(Date.now() / 1000),
  livemode,
  type,
  data: { object },
});

/** Posts the exact bytes Stripe would send, signed with the test secret. */
const postSigned = (event: ReturnType<typeof makeEvent>, secret = TEST_SECRET) => {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return api()
    .post(WEBHOOK)
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', header)
    .send(payload);
};

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

/** A PENDING Stripe booking with a stored PaymentIntent, made through the real endpoints. */
const pendingWithIntent = async () => {
  const { schedule } = await createBookableTrip({ seats: 10, adultFare: 40 });
  const email = `lead-${uniq()}@test.local`;
  const created = await api().post('/api/v1/bookings').send(bookingPayload(schedule.id, { email }));
  expect(created.status).toBe(201);
  const booking = created.body.data as { id: string; reference: string };

  const intentRes = await api().post('/api/v1/payments/intent').send({ bookingId: booking.id, email });
  expect(intentRes.status).toBe(200);

  const intent = (await createIntent.mock.results.at(-1)!.value) as Stripe.PaymentIntent;
  const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
  const succeeded = { ...intent, status: 'succeeded', amount_received: intent.amount } as Stripe.PaymentIntent;
  return { booking, payment, schedule, intent, succeeded };
};

const stateOf = (bookingId: string) =>
  prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { payment: true } });

const eventRow = (id: string) => prisma.stripeWebhookEvent.findUnique({ where: { id } });

let paymentsWereEnabled: boolean;

beforeAll(() => {
  paymentsWereEnabled = config.payments.enabled;
  config.payments.enabled = true;
});

beforeEach(async () => {
  await resetDb();
  vi.resetAllMocks();
  applyRefundStatusSpy.mockImplementation((...args: unknown[]) => realApply.fn(...args));
  createIntent.mockImplementation(async (params: Stripe.PaymentIntentCreateParams) =>
    fakeIntent({ amount: params.amount, currency: params.currency, metadata: params.metadata as Stripe.Metadata }),
  );
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

describe('signature (AC-7)', () => {
  it('400 and writes nothing without a Stripe-Signature header', async () => {
    const { succeeded } = await pendingWithIntent();
    const event = makeEvent({ type: 'payment_intent.succeeded', object: succeeded });

    const res = await api().post(WEBHOOK).set('Content-Type', 'application/json').send(JSON.stringify(event));

    expect(res.status).toBe(400);
    expect(await prisma.stripeWebhookEvent.count()).toBe(0);
  });

  it('400 and writes nothing when signed with another secret', async () => {
    const { booking, succeeded } = await pendingWithIntent();
    const event = makeEvent({ type: 'payment_intent.succeeded', object: succeeded });

    const res = await postSigned(event, 'whsec_forged');

    expect(res.status).toBe(400);
    expect(await prisma.stripeWebhookEvent.count()).toBe(0);
    expect((await stateOf(booking.id)).status).toBe(BookingStatus.PENDING);
  });

  it('400 when the body was changed after signing', async () => {
    const { succeeded } = await pendingWithIntent();
    const event = makeEvent({ type: 'payment_intent.succeeded', object: succeeded });
    const header = Stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify(event), secret: TEST_SECRET });
    const tampered = JSON.stringify({ ...event, data: { object: { ...succeeded, amount_received: 1 } } });

    const res = await api()
      .post(WEBHOOK)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(tampered);

    expect(res.status).toBe(400);
    expect(await prisma.stripeWebhookEvent.count()).toBe(0);
  });
});

describe('payment_intent.succeeded (AC-8)', () => {
  it('confirms the booking, completes the payment and records the event', async () => {
    const { booking, payment, succeeded } = await pendingWithIntent();
    const event = makeEvent({ type: 'payment_intent.succeeded', object: succeeded });

    const res = await postSigned(event);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    const saved = await stateOf(booking.id);
    expect(saved.status).toBe(BookingStatus.CONFIRMED);
    expect(saved.confirmedAt).not.toBeNull();
    expect(saved.payment).toMatchObject({ status: PaymentStatus.COMPLETED, paymentMethod: 'card' });
    expect(saved.payment?.paidAt).not.toBeNull();

    const row = await eventRow(event.id);
    expect(row).toMatchObject({ type: 'payment_intent.succeeded', paymentId: payment.id, error: null });
    expect(row?.processedAt).not.toBeNull();
  });

  it('the same event delivered twice has no extra effect', async () => {
    const { booking, schedule, succeeded } = await pendingWithIntent();
    const event = makeEvent({ type: 'payment_intent.succeeded', object: succeeded });

    expect((await postSigned(event)).status).toBe(200);
    const first = await stateOf(booking.id);
    const seats = await seatsLeft(schedule.id);

    expect((await postSigned(event)).status).toBe(200);

    const second = await stateOf(booking.id);
    expect(second.confirmedAt).toEqual(first.confirmedAt);
    expect(second.payment?.paidAt).toEqual(first.payment?.paidAt);
    expect(await seatsLeft(schedule.id)).toBe(seats);
    expect(await prisma.stripeWebhookEvent.count()).toBe(1);
  });

  it('two deliveries at the same time apply once', async () => {
    const { booking, schedule, succeeded } = await pendingWithIntent();
    const event = makeEvent({ type: 'payment_intent.succeeded', object: succeeded });
    const seats = await seatsLeft(schedule.id);

    const results = await Promise.all([postSigned(event), postSigned(event), postSigned(event)]);

    expect(results.map(r => r.status)).toEqual([200, 200, 200]);
    expect((await stateOf(booking.id)).status).toBe(BookingStatus.CONFIRMED);
    expect(await seatsLeft(schedule.id)).toBe(seats);
    expect(await prisma.stripeWebhookEvent.count()).toBe(1);
  });

  it('two different events for one intent confirm once', async () => {
    const { booking, succeeded } = await pendingWithIntent();

    const results = await Promise.all([
      postSigned(makeEvent({ type: 'payment_intent.succeeded', object: succeeded })),
      postSigned(makeEvent({ type: 'payment_intent.succeeded', object: succeeded })),
    ]);

    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect((await stateOf(booking.id)).status).toBe(BookingStatus.CONFIRMED);
    const rows = await prisma.stripeWebhookEvent.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.processedAt && r.error === null)).toBe(true);
  });

  it('matches by metadata when the intent id was not saved yet, then saves it', async () => {
    const { booking, payment, succeeded } = await pendingWithIntent();
    await prisma.payment.update({ where: { id: payment.id }, data: { stripePaymentIntentId: null } });
    const event = makeEvent({
      type: 'payment_intent.succeeded',
      object: { ...succeeded, metadata: { paymentId: payment.id } },
    });

    expect((await postSigned(event)).status).toBe(200);

    const saved = await stateOf(booking.id);
    expect(saved.status).toBe(BookingStatus.CONFIRMED);
    expect(saved.payment?.stripePaymentIntentId).toBe(succeeded.id);
  });

  it('never applies an intent whose metadata points at a payment holding another intent', async () => {
    const { booking, payment, succeeded } = await pendingWithIntent();
    const other = { ...succeeded, id: `pi_test_${uniq()}`, metadata: { paymentId: payment.id } };
    const event = makeEvent({ type: 'payment_intent.succeeded', object: other });

    const res = await postSigned(event);

    expect(res.status, 'a retry cannot fix this, so Stripe must not retry').toBe(200);
    expect((await stateOf(booking.id)).status).toBe(BookingStatus.PENDING);
    const row = await eventRow(event.id);
    expect(row?.processedAt).not.toBeNull();
    expect(row?.error).toMatch(/^intent_mismatch/);
  });
});

describe('amount or currency mismatch (AC-9, AC-18)', () => {
  it('does not confirm, records the error, completes the payment and refunds it in full', async () => {
    const { booking, payment, succeeded } = await pendingWithIntent();
    const short = { ...succeeded, amount_received: (succeeded.amount as number) - 1 };
    const event = makeEvent({ type: 'payment_intent.succeeded', object: short });

    const res = await postSigned(event);

    expect(res.status).toBe(200);
    const saved = await stateOf(booking.id);
    expect(saved.status).toBe(BookingStatus.PENDING);
    expect(saved.payment?.status).toBe(PaymentStatus.COMPLETED);

    const row = await eventRow(event.id);
    expect(row?.processedAt).not.toBeNull();
    expect(row?.error).toBe(`amount_mismatch: expected 4000 usd got 3999 usd`);

    const refunds = await prisma.refund.findMany({ where: { paymentId: payment.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      reason: RefundReason.ADMIN,
      amountCents: 3999,
      status: RefundStatus.PENDING,
      stripeRefundId: expect.stringMatching(/^re_test_/),
    });
    expect(createRefund).toHaveBeenCalledTimes(1);
    expect(createRefund.mock.calls[0][0]).toMatchObject({ payment_intent: succeeded.id, amount: 3999 });
    expect(createRefund.mock.calls[0][1]).toEqual({ idempotencyKey: `refund-ADMIN-${payment.id}` });
  });

  it('a refund Stripe settles right away marks the payment REFUNDED', async () => {
    createRefund.mockImplementation(async (params: Stripe.RefundCreateParams) => ({
      id: `re_test_${uniq()}`,
      object: 'refund',
      amount: params.amount,
      status: 'succeeded',
    }));
    const { booking, succeeded } = await pendingWithIntent();
    const event = makeEvent({
      type: 'payment_intent.succeeded',
      object: { ...succeeded, currency: 'eur' },
    });

    expect((await postSigned(event)).status).toBe(200);

    const saved = await stateOf(booking.id);
    expect(saved.status).toBe(BookingStatus.PENDING);
    expect(saved.payment?.status).toBe(PaymentStatus.REFUNDED);
    const [refund] = await prisma.refund.findMany({ where: { paymentId: saved.payment!.id } });
    expect(refund.status).toBe(RefundStatus.SUCCEEDED);
    expect(refund.processedAt).not.toBeNull();
  });

  it('a refund Stripe rejects is FAILED and the payment stays COMPLETED (AC-16)', async () => {
    createRefund.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({ message: 'Charge already refunded', type: 'invalid_request_error', code: 'charge_already_refunded' }),
    );
    const { booking, succeeded } = await pendingWithIntent();
    const event = makeEvent({
      type: 'payment_intent.succeeded',
      object: { ...succeeded, amount_received: (succeeded.amount as number) + 1 },
    });

    expect((await postSigned(event)).status).toBe(200);

    const saved = await stateOf(booking.id);
    expect(saved.payment?.status).toBe(PaymentStatus.COMPLETED);
    const [refund] = await prisma.refund.findMany({ where: { paymentId: saved.payment!.id } });
    expect(refund.status).toBe(RefundStatus.FAILED);
    expect(refund.failureMessage).toMatch(/charge_already_refunded/);
  });
});

describe('payment_intent.payment_failed (AC-10)', () => {
  const failed = (intent: Stripe.PaymentIntent, lastError: Partial<Stripe.PaymentIntent.LastPaymentError> | null) =>
    ({ ...intent, status: 'requires_payment_method', last_payment_error: lastError }) as Stripe.PaymentIntent;

  it('keeps the payment PENDING and stores the decline code and message', async () => {
    const { booking, payment, intent } = await pendingWithIntent();
    const event = makeEvent({
      type: 'payment_intent.payment_failed',
      object: failed(intent, { code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.' }),
    });

    expect((await postSigned(event)).status).toBe(200);

    const saved = await stateOf(booking.id);
    expect(saved.status).toBe(BookingStatus.PENDING);
    expect(saved.payment).toMatchObject({
      status: PaymentStatus.PENDING,
      lastFailureCode: 'insufficient_funds',
      lastFailureMessage: 'Your card has insufficient funds.',
    });
    const row = await eventRow(event.id);
    expect(row).toMatchObject({ paymentId: payment.id, error: null });
    expect(row?.processedAt).not.toBeNull();
  });

  it('falls back to the error code when there is no decline code', async () => {
    const { booking, intent } = await pendingWithIntent();
    const event = makeEvent({
      type: 'payment_intent.payment_failed',
      object: failed(intent, { code: 'expired_card', message: 'Your card has expired.' }),
    });

    await postSigned(event);

    expect((await stateOf(booking.id)).payment?.lastFailureCode).toBe('expired_card');
  });

  it('uses unknown and a default message when Stripe sends no error details', async () => {
    const { booking, intent } = await pendingWithIntent();
    const event = makeEvent({ type: 'payment_intent.payment_failed', object: failed(intent, null) });

    await postSigned(event);

    expect((await stateOf(booking.id)).payment).toMatchObject({
      lastFailureCode: 'unknown',
      lastFailureMessage: 'Payment failed',
    });
  });

  it('a failure that arrives after the success changes nothing', async () => {
    const { booking, intent, succeeded } = await pendingWithIntent();
    await postSigned(makeEvent({ type: 'payment_intent.succeeded', object: succeeded }));

    const res = await postSigned(
      makeEvent({ type: 'payment_intent.payment_failed', object: failed(intent, { code: 'card_declined', message: 'Declined' }) }),
    );

    expect(res.status).toBe(200);
    const saved = await stateOf(booking.id);
    expect(saved.status).toBe(BookingStatus.CONFIRMED);
    expect(saved.payment).toMatchObject({
      status: PaymentStatus.COMPLETED,
      lastFailureCode: null,
      lastFailureMessage: null,
    });
  });
});

describe('refund.updated', () => {
  const completedWithRefund = async () => {
    const { booking, payment, succeeded } = await pendingWithIntent();
    await postSigned(makeEvent({ type: 'payment_intent.succeeded', object: succeeded }));
    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        amountCents: 4000,
        reason: RefundReason.LATE_PAYMENT,
        status: RefundStatus.PENDING,
        stripeRefundId: `re_test_${uniq()}`,
      },
    });
    return { booking, payment, refund };
  };

  it('succeeded: refund SUCCEEDED with processedAt, payment REFUNDED', async () => {
    const { payment, refund } = await completedWithRefund();
    const event = makeEvent({
      type: 'refund.updated',
      object: { id: refund.stripeRefundId, object: 'refund', status: 'succeeded', failure_reason: null },
    });

    expect((await postSigned(event)).status).toBe(200);

    const saved = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(saved.status).toBe(RefundStatus.SUCCEEDED);
    expect(saved.processedAt).not.toBeNull();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      PaymentStatus.REFUNDED,
    );
    expect(await eventRow(event.id)).toMatchObject({ paymentId: payment.id, error: null });
  });

  it.each(['failed', 'canceled'])('%s: refund FAILED with the reason, payment stays COMPLETED (AC-16)', async status => {
    const { payment, refund } = await completedWithRefund();
    const event = makeEvent({
      type: 'refund.updated',
      object: { id: refund.stripeRefundId, object: 'refund', status, failure_reason: 'expired_or_canceled_card' },
    });

    expect((await postSigned(event)).status).toBe(200);

    const saved = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(saved).toMatchObject({ status: RefundStatus.FAILED, failureMessage: 'expired_or_canceled_card' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      PaymentStatus.COMPLETED,
    );
  });

  it('pending: nothing changes until a later update settles it', async () => {
    const { refund } = await completedWithRefund();
    const event = makeEvent({
      type: 'refund.updated',
      object: { id: refund.stripeRefundId, object: 'refund', status: 'pending', failure_reason: null },
    });

    expect((await postSigned(event)).status).toBe(200);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe(RefundStatus.PENDING);
  });

  it('an unknown refund is recorded as an error and answered 200', async () => {
    const event = makeEvent({
      type: 'refund.updated',
      object: { id: 're_test_unknown', object: 'refund', status: 'succeeded', failure_reason: null },
    });

    expect((await postSigned(event)).status).toBe(200);
    const row = await eventRow(event.id);
    expect(row?.processedAt).not.toBeNull();
    expect(row?.error).toBe('unknown_refund: no refund for re_test_unknown');
  });
});

describe('errors and unfixable events (AC-11)', () => {
  it('a thrown error answers 500, stores the error, and the retry succeeds and clears it', async () => {
    const { completedRefund } = await (async () => {
      const { payment, succeeded } = await pendingWithIntent();
      await postSigned(makeEvent({ type: 'payment_intent.succeeded', object: succeeded }));
      const refund = await prisma.refund.create({
        data: {
          paymentId: payment.id,
          amountCents: 4000,
          reason: RefundReason.LATE_PAYMENT,
          stripeRefundId: `re_test_${uniq()}`,
        },
      });
      return { completedRefund: refund };
    })();
    applyRefundStatusSpy.mockRejectedValueOnce(new Error('database went away'));
    const event = makeEvent({
      type: 'refund.updated',
      object: { id: completedRefund.stripeRefundId, object: 'refund', status: 'succeeded', failure_reason: null },
    });

    const first = await postSigned(event);

    expect(first.status).toBe(500);
    let row = await eventRow(event.id);
    expect(row?.processedAt, 'nothing marked done, so Stripe retries').toBeNull();
    expect(row?.error).toBe('database went away');
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: completedRefund.id } })).status).toBe(
      RefundStatus.PENDING,
    );

    const retry = await postSigned(event);

    expect(retry.status).toBe(200);
    row = await eventRow(event.id);
    expect(row?.processedAt).not.toBeNull();
    expect(row?.error).toBeNull();
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: completedRefund.id } })).status).toBe(
      RefundStatus.SUCCEEDED,
    );
  });

  it('an unhandled event type is recorded with its reason and answered 200', async () => {
    const event = makeEvent({ type: 'charge.dispute.created', object: { id: 'dp_test', object: 'dispute' } });

    const res = await postSigned(event);

    expect(res.status).toBe(200);
    const row = await eventRow(event.id);
    expect(row?.processedAt).not.toBeNull();
    expect(row?.error).toBe('unhandled_event_type: charge.dispute.created');
  });

  it('a live event on a test key is recorded as an error and never applied', async () => {
    const { booking, succeeded } = await pendingWithIntent();
    const event = makeEvent({
      type: 'payment_intent.succeeded',
      object: { ...succeeded, livemode: true },
      livemode: true,
    });

    const res = await postSigned(event);

    expect(res.status).toBe(200);
    expect((await stateOf(booking.id)).status).toBe(BookingStatus.PENDING);
    const row = await eventRow(event.id);
    expect(row?.processedAt).not.toBeNull();
    expect(row?.error).toBe('livemode_mismatch: event livemode true');
  });

  it('an event for an unknown intent is recorded as an error and answered 200', async () => {
    const event = makeEvent({
      type: 'payment_intent.succeeded',
      object: fakeIntent({ status: 'succeeded', amount_received: 4000 }),
    });

    const res = await postSigned(event);

    expect(res.status).toBe(200);
    expect((await eventRow(event.id))?.error).toMatch(/^unknown_payment/);
  });
});

describe('configuration and request shape (AC-7)', () => {
  it('500 without STRIPE_WEBHOOK_SECRET, so Stripe keeps the event and retries after the fix', async () => {
    const { booking, succeeded } = await pendingWithIntent();
    const saved = stripeConfig.webhookSecret;
    stripeConfig.webhookSecret = '';
    try {
      const res = await postSigned(makeEvent({ type: 'payment_intent.succeeded', object: succeeded }));

      expect(res.status).toBe(500);
      expect(await prisma.stripeWebhookEvent.count()).toBe(0);
      expect((await stateOf(booking.id)).status).toBe(BookingStatus.PENDING);
    } finally {
      stripeConfig.webhookSecret = saved;
    }
  });

  it('400 for a correctly signed body sent as text/plain (the raw parser only reads JSON)', async () => {
    const { succeeded } = await pendingWithIntent();
    const payload = JSON.stringify(makeEvent({ type: 'payment_intent.succeeded', object: succeeded }));
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: TEST_SECRET });

    const res = await api()
      .post(WEBHOOK)
      .set('Content-Type', 'text/plain')
      .set('Stripe-Signature', header)
      .send(payload);

    expect(res.status).toBe(400);
    expect(await prisma.stripeWebhookEvent.count()).toBe(0);
  });

  it('400 for a signature older than the tolerance window (a replayed capture)', async () => {
    const { succeeded } = await pendingWithIntent();
    const payload = JSON.stringify(makeEvent({ type: 'payment_intent.succeeded', object: succeeded }));
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: TEST_SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 60 * 60,
    });

    const res = await api()
      .post(WEBHOOK)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(payload);

    expect(res.status).toBe(400);
  });
});

describe('money invariants across repeated mismatch events (AC-18)', () => {
  const paymentRow = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });

  it('a second mismatch event for the same payment never creates a second refund', async () => {
    const { payment, succeeded } = await pendingWithIntent();
    const short = { ...succeeded, amount_received: (succeeded.amount as number) - 1 };

    await postSigned(makeEvent({ type: 'payment_intent.succeeded', object: short }));
    const second = makeEvent({ type: 'payment_intent.succeeded', object: short });
    const res = await postSigned(second);

    expect(res.status).toBe(200);
    expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(createRefund).toHaveBeenCalledTimes(1);
    expect((await eventRow(second.id))?.error, 'the repeat is a duplicate, not a new mismatch').toBeNull();
  });

  it('two different mismatch events at the same time create one refund', async () => {
    const { payment, succeeded } = await pendingWithIntent();
    const over = { ...succeeded, amount_received: (succeeded.amount as number) + 1 };

    const results = await Promise.all([
      postSigned(makeEvent({ type: 'payment_intent.succeeded', object: over })),
      postSigned(makeEvent({ type: 'payment_intent.succeeded', object: over })),
    ]);

    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
    expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.COMPLETED);
  });
});

describe('refund.updated never revives a FAILED refund (AC-16)', () => {
  it('a succeeded update after a failed one leaves the refund FAILED and the payment COMPLETED', async () => {
    const { payment, succeeded } = await pendingWithIntent();
    await postSigned(makeEvent({ type: 'payment_intent.succeeded', object: succeeded }));
    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        amountCents: 4000,
        reason: RefundReason.LATE_PAYMENT,
        stripeRefundId: `re_test_${uniq()}`,
      },
    });
    const update = (status: string) =>
      makeEvent({
        type: 'refund.updated',
        object: { id: refund.stripeRefundId, object: 'refund', status, failure_reason: 'lost_or_stolen_card' },
      });

    await postSigned(update('failed'));
    const res = await postSigned(update('succeeded'));

    expect(res.status).toBe(200);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe(RefundStatus.FAILED);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      PaymentStatus.COMPLETED,
    );
  });
});

describe('no sensitive data in responses, event rows or logs (security model)', () => {
  it('the response body is only { received: true }', async () => {
    const { succeeded } = await pendingWithIntent();

    const res = await postSigned(makeEvent({ type: 'payment_intent.succeeded', object: succeeded }));

    expect(res.body).toEqual({ received: true });
  });

  it('a database error is stored on the event row by its code only, never its message text', async () => {
    const { payment, succeeded } = await pendingWithIntent();
    await postSigned(makeEvent({ type: 'payment_intent.succeeded', object: succeeded }));
    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        amountCents: 4000,
        reason: RefundReason.LATE_PAYMENT,
        stripeRefundId: `re_test_${uniq()}`,
      },
    });
    applyRefundStatusSpy.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed: lead@private.example', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const event = makeEvent({
      type: 'refund.updated',
      object: { id: refund.stripeRefundId, object: 'refund', status: 'succeeded', failure_reason: null },
    });

    const res = await postSigned(event);

    expect(res.status).toBe(500);
    expect((await eventRow(event.id))?.error).toBe('database_error: P2002');
  });

  it('webhook log lines carry ids and outcome, never the lead email, client secret or webhook secret', async () => {
    const { booking: created, succeeded } = await pendingWithIntent();
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: created.id } });
    const spies = (['info', 'warn', 'error'] as const).map(level => vi.spyOn(logger, level));
    const event = makeEvent({ type: 'payment_intent.succeeded', object: succeeded });

    try {
      await postSigned(event);
      await postSigned(
        makeEvent({ type: 'payment_intent.payment_failed', object: { ...succeeded, last_payment_error: null } }),
      );

      const lines = spies.flatMap(spy => spy.mock.calls.map(call => call.map(String).join(' ')));
      const webhookLines = lines.filter(line => /Stripe webhook|applyIntentResult|Booking .* confirmed/.test(line));
      expect(webhookLines.some(line => line.includes(event.id) && line.includes(booking.id))).toBe(true);
      for (const line of webhookLines) {
        expect(line).not.toContain(booking.leadPassengerEmail);
        expect(line).not.toContain(succeeded.client_secret as string);
        expect(line).not.toContain(TEST_SECRET);
      }
    } finally {
      spies.forEach(spy => spy.mockRestore());
    }
  });
});
