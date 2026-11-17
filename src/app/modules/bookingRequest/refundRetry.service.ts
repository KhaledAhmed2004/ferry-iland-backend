import { StatusCodes } from 'http-status-codes';
import { RefundStatus } from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { sendRefunds } from '../payment/payment.refund';
import { isUniqueViolation, policyError, refundableCents } from '../booking/booking.policy';

/**
 * Spec 0004, AC-21: an admin retries a refund Stripe rejected. A new PENDING refund (same
 * reason, amount = what is still owed) is written, then sent after commit with its own
 * idempotency key (`refund-retry-<refundId>`). The failed row stays as the record of the attempt.
 */
const retryRefund = async (refundId: string, adminUserId: string) => {
  const newRefundId = await prisma.$transaction(async tx => {
    const failed = await tx.refund.findUnique({
      where: { id: refundId },
      include: { payment: { include: { refunds: true } } },
    });
    if (!failed) throw new ApiError(StatusCodes.NOT_FOUND, 'Refund not found');

    if (failed.status !== RefundStatus.FAILED) {
      throw policyError('REFUND_NOT_FAILED', 'Only a failed refund can be retried.');
    }

    // A PENDING or SUCCEEDED refund already covers what is owed: nothing to send again.
    const amountCents = refundableCents(failed.payment);
    if (amountCents <= 0) {
      throw policyError('NOTHING_TO_REFUND', 'Nothing is left to refund on this payment.');
    }

    try {
      const retry = await tx.refund.create({
        data: {
          paymentId: failed.paymentId,
          amountCents,
          reason: failed.reason,
          status: RefundStatus.PENDING,
          requestedByUserId: adminUserId,
        },
      });
      return retry.id;
    } catch (error) {
      // Two admins retrying at once: the one live cancel refund index lets only one through.
      if (isUniqueViolation(error)) {
        throw policyError('REFUND_EXISTS', 'A refund for this payment is already in progress.');
      }
      throw error;
    }
  });

  // Never throws; a refund Stripe could not take yet stays PENDING for the sweep.
  await sendRefunds([newRefundId]);

  const refund = await prisma.refund.findUniqueOrThrow({ where: { id: newRefundId } });
  return {
    id: refund.id,
    paymentId: refund.paymentId,
    amountCents: refund.amountCents,
    reason: refund.reason,
    status: refund.status,
    failureMessage: refund.failureMessage,
  };
};

export const RefundRetryService = { retryRefund };
