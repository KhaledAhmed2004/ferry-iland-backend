import { PaymentStatus, RefundReason, RefundStatus } from '@prisma/client';
import Stripe from 'stripe';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * sendRefund against a real Postgres with the Stripe client stubbed (spec 0002: late refund
 * steps 2 and 3, AC-16, AC-18, and the PENDING left behind for the AC-19 sweep).
 * Run with `npm run test:int`.
 */
const { stripeHolder, createRefund } = vi.hoisted(() => {
  const createRefund = vi.fn();
  return {
    createRefund,
    stripeHolder: { client: { refunds: { create: createRefund } } as unknown },
  };
});

vi.mock('../../../../config/stripe', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../config/stripe')>()),
  // A getter, so one test can run with no Stripe key configured.
  get stripe() {
    return stripeHolder.client;
  },
}));

import app from '../../../../app';
import config from '../../../../config';
import { sendRefund, sendRefunds } from '../payment.refund';
import { bookingPayload, createBookableTrip, prisma, resetDb, uniq } from '../../../../../test/integration/helpers';

const stripeClient = { refunds: { create: createRefund } };

/** A COMPLETED Stripe payment with a PENDING refund row, the state applyIntentResult leaves. */
const paymentWithPendingRefund = async (refundOverrides: Record<string, unknown> = {}) => {
  const { schedule } = await createBookableTrip({ adultFare: 40 });
  const res = await request(app).post('/api/v1/bookings').send(bookingPayload(schedule.id));
  expect(res.status).toBe(201);
  const payment = await prisma.payment.update({
    where: { bookingId: res.body.data.id },
    data: { status: PaymentStatus.COMPLETED, stripePaymentIntentId: `pi_test_${uniq()}`, paidAt: new Date() },
  });
  const refund = await prisma.refund.create({
    data: {
      paymentId: payment.id,
      amountCents: payment.amountCents,
      reason: RefundReason.LATE_PAYMENT,
      status: RefundStatus.PENDING,
      ...refundOverrides,
    },
  });
  return { payment, refund };
};

const refundRow = (id: string) => prisma.refund.findUniqueOrThrow({ where: { id } });
const paymentRow = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });

const stripeRefund = (status: string) => async (params: Stripe.RefundCreateParams) => ({
  id: `re_test_${uniq()}`,
  object: 'refund',
  amount: params.amount,
  status,
});

let paymentsWereEnabled: boolean;

beforeAll(() => {
  paymentsWereEnabled = config.payments.enabled;
  config.payments.enabled = true;
});

beforeEach(async () => {
  await resetDb();
  vi.resetAllMocks();
  stripeHolder.client = stripeClient;
  createRefund.mockImplementation(stripeRefund('pending'));
});

afterAll(async () => {
  config.payments.enabled = paymentsWereEnabled;
  await prisma.$disconnect();
});

describe('sendRefund', () => {
  it('sends the full amount for the payment intent with the reason and payment idempotency key', async () => {
    const { payment, refund } = await paymentWithPendingRefund();

    await sendRefund(refund.id);

    expect(createRefund).toHaveBeenCalledTimes(1);
    const [params, options] = createRefund.mock.calls[0];
    expect(params).toEqual({
      payment_intent: payment.stripePaymentIntentId,
      amount: payment.amountCents,
      metadata: { refundId: refund.id, paymentId: payment.id, bookingId: payment.bookingId },
    });
    expect(options).toEqual({ idempotencyKey: `refund-LATE_PAYMENT-${payment.id}` });
  });

  it('pending at Stripe: saves the Stripe refund id and keeps the refund PENDING', async () => {
    const { payment, refund } = await paymentWithPendingRefund();

    await sendRefund(refund.id);

    const saved = await refundRow(refund.id);
    expect(saved.status).toBe(RefundStatus.PENDING);
    expect(saved.stripeRefundId).toMatch(/^re_test_/);
    expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.COMPLETED);
  });

  it('succeeded at Stripe: refund SUCCEEDED with processedAt, payment REFUNDED', async () => {
    createRefund.mockImplementation(stripeRefund('succeeded'));
    const { payment, refund } = await paymentWithPendingRefund();

    await sendRefund(refund.id);

    const saved = await refundRow(refund.id);
    expect(saved.status).toBe(RefundStatus.SUCCEEDED);
    expect(saved.processedAt).not.toBeNull();
    expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.REFUNDED);
  });

  it('a Stripe rejection marks the refund FAILED with the Stripe code, payment stays COMPLETED (AC-16)', async () => {
    createRefund.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: 'This PaymentIntent does not have a successful charge to refund.',
        type: 'invalid_request_error',
        code: 'charge_not_refundable',
      }),
    );
    const { payment, refund } = await paymentWithPendingRefund();

    await expect(sendRefund(refund.id)).resolves.toBeUndefined();

    const saved = await refundRow(refund.id);
    expect(saved.status).toBe(RefundStatus.FAILED);
    expect(saved.failureMessage).toMatch(/^charge_not_refundable: /);
    expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.COMPLETED);
  });

  it('a network problem (not a Stripe answer) leaves the refund PENDING with no Stripe id, for the sweep', async () => {
    createRefund.mockRejectedValue(new Error('socket hang up'));
    const { refund } = await paymentWithPendingRefund();

    await expect(sendRefund(refund.id)).resolves.toBeUndefined();

    const saved = await refundRow(refund.id);
    expect(saved.status).toBe(RefundStatus.PENDING);
    expect(saved.stripeRefundId).toBeNull();
  });

  it('without STRIPE_SECRET_KEY: makes no call and leaves the refund PENDING', async () => {
    stripeHolder.client = null;
    const { refund } = await paymentWithPendingRefund();

    await sendRefund(refund.id);

    expect(createRefund).not.toHaveBeenCalled();
    expect((await refundRow(refund.id)).status).toBe(RefundStatus.PENDING);
  });

  it('a payment with no PaymentIntent is never sent to Stripe', async () => {
    const { payment, refund } = await paymentWithPendingRefund();
    await prisma.payment.update({ where: { id: payment.id }, data: { stripePaymentIntentId: null } });

    await sendRefund(refund.id);

    expect(createRefund).not.toHaveBeenCalled();
    expect((await refundRow(refund.id)).status).toBe(RefundStatus.PENDING);
  });

  it.each([
    ['already sent (has a Stripe id)', { stripeRefundId: 're_test_already_sent' }],
    ['already SUCCEEDED', { status: RefundStatus.SUCCEEDED }],
    ['FAILED, which is never retried automatically (AC-16)', { status: RefundStatus.FAILED }],
  ])('a refund %s is skipped', async (_label, overrides) => {
    const { refund } = await paymentWithPendingRefund(overrides);

    await sendRefund(refund.id);

    expect(createRefund).not.toHaveBeenCalled();
  });

  it('an unknown refund id does nothing and does not throw', async () => {
    await expect(sendRefund('00000000-0000-4000-8000-000000000000')).resolves.toBeUndefined();
    expect(createRefund).not.toHaveBeenCalled();
  });

  it('sendRefunds sends each refund in turn', async () => {
    const a = await paymentWithPendingRefund();
    const b = await paymentWithPendingRefund();

    await sendRefunds([a.refund.id, b.refund.id]);

    expect(createRefund).toHaveBeenCalledTimes(2);
    expect((await refundRow(a.refund.id)).stripeRefundId).not.toBeNull();
    expect((await refundRow(b.refund.id)).stripeRefundId).not.toBeNull();
  });
});
