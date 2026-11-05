import Stripe from 'stripe';
import { PaymentStatus, Prisma, RefundStatus } from '@prisma/client';
import { prisma } from '../../../shared/prisma';
import { logger } from '../../../shared/logger';
import { stripe } from '../../../config/stripe';

/**
 * Spec 0002: automatic refunds (amount mismatch here; late payment and payment after cancel in
 * the seat hold child). The Refund row is written inside the caller's transaction; the Stripe
 * call runs after the commit through sendRefund, with an idempotency key per reason and payment.
 */

type Db = Prisma.TransactionClient;

/** Index contract, refund status mapping. */
export const mapStripeRefundStatus = (status: string | null | undefined): RefundStatus => {
  if (status === 'succeeded') return RefundStatus.SUCCEEDED;
  if (status === 'failed' || status === 'canceled') return RefundStatus.FAILED;
  // pending, requires_action: settled later by a refund.updated event.
  return RefundStatus.PENDING;
};

export const refundIdempotencyKey = (reason: string, paymentId: string) =>
  `refund-${reason}-${paymentId}`;

type RefundRef = { id: string; paymentId: string };

/**
 * Moves a PENDING refund to the status Stripe reports. Conditional on PENDING, so a repeat event
 * or a race between the create response and refund.updated applies only once. Returns the new
 * status, or null when nothing changed.
 */
export const applyRefundStatus = async (
  db: Db,
  refund: RefundRef,
  stripeRefund: Pick<Stripe.Refund, 'status' | 'failure_reason'>,
  context: { bookingId?: string | null } = {},
): Promise<RefundStatus | null> => {
  const status = mapStripeRefundStatus(stripeRefund.status);
  if (status === RefundStatus.PENDING) return null;

  if (status === RefundStatus.SUCCEEDED) {
    const updated = await db.refund.updateMany({
      where: { id: refund.id, status: RefundStatus.PENDING },
      data: { status: RefundStatus.SUCCEEDED, processedAt: new Date(), failureMessage: null },
    });
    if (updated.count !== 1) return null;
    await db.payment.updateMany({
      where: { id: refund.paymentId, status: PaymentStatus.COMPLETED },
      data: { status: PaymentStatus.REFUNDED },
    });
    logger.info(`Refund ${refund.id} succeeded for payment ${refund.paymentId}`);
    return status;
  }

  // AC-16: FAILED, payment stays COMPLETED, nothing retries it automatically.
  const failureMessage = stripeRefund.failure_reason ?? `Refund ${stripeRefund.status}`;
  const updated = await db.refund.updateMany({
    where: { id: refund.id, status: RefundStatus.PENDING },
    data: { status: RefundStatus.FAILED, failureMessage },
  });
  if (updated.count !== 1) return null;
  logger.error(
    `Refund failed: refund ${refund.id} payment ${refund.paymentId} booking ${context.bookingId ?? 'unknown'}: ${failureMessage}`,
  );
  return status;
};

/**
 * Sends one PENDING refund to Stripe and records the answer. Never throws: a Stripe rejection
 * marks the refund FAILED (AC-16); any other problem leaves it PENDING for the pending refund
 * sweep (AC-19), which resends it with the same idempotency key.
 */
export const sendRefund = async (refundId: string): Promise<void> => {
  const refund = await prisma.refund
    .findUnique({ where: { id: refundId }, include: { payment: true } })
    .catch(error => {
      logger.error(`Refund ${refundId} could not be loaded: ${(error as Error)?.message}`);
      return null;
    });
  if (!refund || refund.status !== RefundStatus.PENDING || refund.stripeRefundId) return;

  const { payment } = refund;
  const ids = `refund ${refund.id} payment ${payment.id} booking ${payment.bookingId}`;

  if (!stripe) {
    logger.warn(`STRIPE_SECRET_KEY not set, ${ids} left PENDING for the sweep`);
    return;
  }
  if (!payment.stripePaymentIntentId) {
    logger.error(`Cannot refund without a PaymentIntent: ${ids}`);
    return;
  }

  let stripeRefund: Stripe.Refund;
  try {
    stripeRefund = await stripe.refunds.create(
      {
        payment_intent: payment.stripePaymentIntentId,
        amount: refund.amountCents,
        metadata: { refundId: refund.id, paymentId: payment.id, bookingId: payment.bookingId },
      },
      { idempotencyKey: refundIdempotencyKey(refund.reason, payment.id) },
    );
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      const failureMessage = `${error.code ?? error.type}: ${error.message}`;
      await prisma.refund
        .updateMany({
          where: { id: refund.id, status: RefundStatus.PENDING },
          data: { status: RefundStatus.FAILED, failureMessage },
        })
        .catch(dbError =>
          logger.error(`Could not mark ${ids} FAILED: ${(dbError as Error)?.message}`),
        );
      logger.error(`Stripe rejected ${ids}: ${error.type} ${error.code ?? ''}`);
      return;
    }
    logger.error(`Refund call failed for ${ids}, left PENDING: ${(error as Error)?.message}`);
    return;
  }

  try {
    await prisma.$transaction(async tx => {
      await tx.refund.updateMany({
        where: { id: refund.id, stripeRefundId: null },
        data: { stripeRefundId: stripeRefund.id },
      });
      await applyRefundStatus(tx, refund, stripeRefund, { bookingId: payment.bookingId });
    });
    logger.info(`Stripe refund ${stripeRefund.id} (${stripeRefund.status}) saved for ${ids}`);
  } catch (error) {
    logger.error(
      `Stripe refund ${stripeRefund.id} created but not saved for ${ids}: ${(error as Error)?.message}`,
    );
  }
};

export const sendRefunds = async (refundIds: string[]): Promise<void> => {
  for (const id of refundIds) {
    await sendRefund(id);
  }
};
