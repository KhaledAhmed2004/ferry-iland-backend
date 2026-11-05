import { PaymentStatus, RefundStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { applyRefundStatus, mapStripeRefundStatus, refundIdempotencyKey } from '../payment.refund';

/**
 * Unit tests for the refund helpers (spec 0002, index contract "refund status mapping", AC-16,
 * AC-18). The database is the boundary here, so it is a small fake that records each call.
 */

const fakeDb = (refundRowsChanged = 1) => {
  const refundUpdateMany = vi.fn().mockResolvedValue({ count: refundRowsChanged });
  const paymentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const db = { refund: { updateMany: refundUpdateMany }, payment: { updateMany: paymentUpdateMany } };
  return { db: db as never, refundUpdateMany, paymentUpdateMany };
};

const refund = { id: 'refund-1', paymentId: 'payment-1' };

describe('mapStripeRefundStatus (index contract)', () => {
  it('maps succeeded to SUCCEEDED', () => {
    expect(mapStripeRefundStatus('succeeded')).toBe(RefundStatus.SUCCEEDED);
  });

  it.each(['failed', 'canceled'])('maps %s to FAILED', status => {
    expect(mapStripeRefundStatus(status)).toBe(RefundStatus.FAILED);
  });

  it.each(['pending', 'requires_action', null, undefined, 'some_future_status'])(
    'keeps %s as PENDING until a refund.updated settles it',
    status => {
      expect(mapStripeRefundStatus(status)).toBe(RefundStatus.PENDING);
    },
  );
});

describe('refundIdempotencyKey', () => {
  it('is refund-<reason>-<paymentId>, so one reason refunds a payment at most once', () => {
    expect(refundIdempotencyKey('ADMIN', 'abc')).toBe('refund-ADMIN-abc');
    expect(refundIdempotencyKey('LATE_PAYMENT', 'abc')).not.toBe(refundIdempotencyKey('ADMIN', 'abc'));
  });
});

describe('applyRefundStatus', () => {
  it('succeeded: marks the refund SUCCEEDED and the COMPLETED payment REFUNDED', async () => {
    const { db, refundUpdateMany, paymentUpdateMany } = fakeDb();

    const result = await applyRefundStatus(db, refund, { status: 'succeeded', failure_reason: null });

    expect(result).toBe(RefundStatus.SUCCEEDED);
    expect(refundUpdateMany).toHaveBeenCalledWith({
      where: { id: 'refund-1', status: RefundStatus.PENDING },
      data: expect.objectContaining({ status: RefundStatus.SUCCEEDED, processedAt: expect.any(Date) }),
    });
    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: PaymentStatus.COMPLETED },
      data: { status: PaymentStatus.REFUNDED },
    });
  });

  it('failed: marks the refund FAILED with Stripe\'s reason and leaves the payment alone (AC-16)', async () => {
    const { db, refundUpdateMany, paymentUpdateMany } = fakeDb();

    const result = await applyRefundStatus(db, refund, {
      status: 'failed',
      failure_reason: 'expired_or_canceled_card',
    });

    expect(result).toBe(RefundStatus.FAILED);
    expect(refundUpdateMany).toHaveBeenCalledWith({
      where: { id: 'refund-1', status: RefundStatus.PENDING },
      data: { status: RefundStatus.FAILED, failureMessage: 'expired_or_canceled_card' },
    });
    expect(paymentUpdateMany).not.toHaveBeenCalled();
  });

  it('uses a readable message when Stripe gives no failure reason', async () => {
    const { db, refundUpdateMany } = fakeDb();

    await applyRefundStatus(db, refund, { status: 'canceled', failure_reason: null });

    expect(refundUpdateMany.mock.calls[0][0].data.failureMessage).toBe('Refund canceled');
  });

  it('pending: writes nothing', async () => {
    const { db, refundUpdateMany, paymentUpdateMany } = fakeDb();

    const result = await applyRefundStatus(db, refund, { status: 'pending', failure_reason: null });

    expect(result).toBeNull();
    expect(refundUpdateMany).not.toHaveBeenCalled();
    expect(paymentUpdateMany).not.toHaveBeenCalled();
  });

  it('a refund already settled by a concurrent caller is not touched again, and the payment is not changed', async () => {
    const { db, paymentUpdateMany } = fakeDb(0);

    const result = await applyRefundStatus(db, refund, { status: 'succeeded', failure_reason: null });

    expect(result).toBeNull();
    expect(paymentUpdateMany).not.toHaveBeenCalled();
  });
});
