import Stripe from 'stripe';
import { PaymentStatus, Prisma } from '@prisma/client';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../../shared/prisma';
import { logger } from '../../../shared/logger';
import { isLiveStripeKey, stripeConfig } from '../../../config/stripe';
import { IWebhookHandlerResult } from './payment.interface';
import { applyRefundStatus, sendRefunds } from './payment.refund';
import { applyIntentResultInTx, findPaymentForIntent } from './payment.service';

/**
 * POST /api/v1/payments/webhook (spec 0002, child "payment confirmation webhook", AC-7 to AC-11).
 *
 * Only a valid Stripe-Signature over the raw body is trusted. Each event id is claimed and
 * finished inside the same transaction as its effects, so a crash halfway leaves nothing applied
 * and nothing marked done, and Stripe's retry simply runs it again.
 */

type Db = Prisma.TransactionClient;

export type WebhookResponse = { status: number; body: Record<string, unknown> };

const MAX_ERROR_LENGTH = 500;

/** Error text for the event row: the message only, never a payload (Prisma errors by code). */
const errorText = (error: unknown): string => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `database_error: ${error.code}`;
  if (error instanceof Prisma.PrismaClientValidationError) return 'database_error: validation';
  const message = (error as Error)?.message ?? String(error);
  return message.split('\n')[0].slice(0, MAX_ERROR_LENGTH);
};

/** AC-7: a missing or invalid signature is a 400 and writes nothing. */
const verifyEvent = (
  rawBody: unknown,
  signature: string | string[] | undefined,
): { event: Stripe.Event } | { response: WebhookResponse } => {
  const secret = stripeConfig.webhookSecret;
  if (!secret) {
    // Our own setup problem: 500 so Stripe keeps the event and retries once it is fixed.
    logger.error('Stripe webhook received but STRIPE_WEBHOOK_SECRET is not set');
    return {
      response: { status: StatusCodes.INTERNAL_SERVER_ERROR, body: { error: 'Webhook not configured' } },
    };
  }
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !signature) {
    logger.warn('Stripe webhook rejected: missing signature or raw body');
    return { response: { status: StatusCodes.BAD_REQUEST, body: { error: 'Invalid signature' } } };
  }
  try {
    return { event: Stripe.webhooks.constructEvent(rawBody, signature, secret) };
  } catch {
    logger.warn('Stripe webhook rejected: signature verification failed');
    return { response: { status: StatusCodes.BAD_REQUEST, body: { error: 'Invalid signature' } } };
  }
};

const unfixable = (
  error: string,
  ids: { paymentId?: string | null; bookingId?: string | null } = {},
): IWebhookHandlerResult => ({
  outcome: 'error',
  paymentId: ids.paymentId ?? null,
  bookingId: ids.bookingId ?? null,
  error,
  refundIds: [],
});

/** payment_intent.succeeded: the shared write path (AC-8, AC-9, AC-18). */
const handleIntentSucceeded = async (
  tx: Db,
  intent: Stripe.PaymentIntent,
): Promise<IWebhookHandlerResult> => {
  const { result, refundIds } = await applyIntentResultInTx(tx, intent, 'webhook');
  return { ...result, refundIds };
};

/**
 * payment_intent.payment_failed (AC-10): a declined card keeps the payment PENDING so the
 * customer can retry, and records why. A payment that is no longer PENDING changes nothing.
 */
const handleIntentFailed = async (
  tx: Db,
  intent: Stripe.PaymentIntent,
): Promise<IWebhookHandlerResult> => {
  const { payment, error } = await findPaymentForIntent(intent, tx);
  const ids = { paymentId: payment?.id ?? null, bookingId: payment?.bookingId ?? null };
  if (error || !payment) return unfixable(error ?? 'unknown_payment', ids);

  const lastError = intent.last_payment_error;
  const updated = await tx.payment.updateMany({
    where: { id: payment.id, status: PaymentStatus.PENDING },
    data: {
      lastFailureCode: lastError?.decline_code ?? lastError?.code ?? 'unknown',
      lastFailureMessage: lastError?.message ?? 'Payment failed',
    },
  });
  return {
    outcome: updated.count === 1 ? 'failure_recorded' : 'ignored_not_pending',
    ...ids,
    refundIds: [],
  };
};

/** refund.updated: settles a refund Stripe left pending (index contract, refund status mapping). */
const handleRefundUpdated = async (
  tx: Db,
  stripeRefund: Stripe.Refund,
): Promise<IWebhookHandlerResult> => {
  const refund = await tx.refund.findUnique({
    where: { stripeRefundId: stripeRefund.id },
    include: { payment: { select: { bookingId: true } } },
  });
  if (!refund) return unfixable(`unknown_refund: no refund for ${stripeRefund.id}`);

  const ids = { paymentId: refund.paymentId, bookingId: refund.payment.bookingId };
  const status = await applyRefundStatus(tx, refund, stripeRefund, { bookingId: ids.bookingId });
  return {
    outcome: status ? `refund_${status.toLowerCase()}` : 'refund_unchanged',
    ...ids,
    refundIds: [],
  };
};

const handleEvent = async (tx: Db, event: Stripe.Event): Promise<IWebhookHandlerResult> => {
  // AC-11 rule: a test event on a live key (or the reverse) is recorded, never applied.
  if (event.livemode !== isLiveStripeKey()) {
    return unfixable(`livemode_mismatch: event livemode ${event.livemode}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      return handleIntentSucceeded(tx, event.data.object);
    case 'payment_intent.payment_failed':
      return handleIntentFailed(tx, event.data.object);
    case 'refund.updated':
      return handleRefundUpdated(tx, event.data.object);
    default:
      // Includes charge.dispute.*: recorded so it is visible, not acted on.
      logger.warn(`Stripe webhook event ${event.id} of unhandled type ${event.type} recorded`);
      return unfixable(`unhandled_event_type: ${event.type}`);
  }
};

/** Claims the event row, runs the handler, and marks it done, all in one transaction. */
const processEvent = async (event: Stripe.Event): Promise<WebhookResponse> => {
  const received = { status: StatusCodes.OK, body: { received: true } };

  try {
    // Insert if missing; ON CONFLICT DO NOTHING, so two deliveries at once never fail here.
    await prisma.stripeWebhookEvent.createMany({
      data: [{ id: event.id, type: event.type }],
      skipDuplicates: true,
    });
    const existing = await prisma.stripeWebhookEvent.findUnique({ where: { id: event.id } });
    if (existing?.processedAt) {
      logger.info(`Stripe webhook event ${event.id} (${event.type}) already processed`);
      return received;
    }

    const result = await prisma.$transaction(async tx => {
      // The row lock serializes concurrent deliveries of the same event; the second one waits,
      // then sees processedAt and stops.
      const rows = await tx.$queryRaw<{ processedAt: Date | null }[]>`
        SELECT "processedAt" FROM "StripeWebhookEvent" WHERE "id" = ${event.id} FOR UPDATE`;
      if (rows[0]?.processedAt) return null;

      const handled = await handleEvent(tx, event);
      await tx.stripeWebhookEvent.update({
        where: { id: event.id },
        data: {
          processedAt: new Date(),
          error: handled.error ?? null,
          ...(handled.paymentId ? { paymentId: handled.paymentId } : {}),
        },
      });
      return handled;
    });

    if (!result) {
      logger.info(`Stripe webhook event ${event.id} (${event.type}) already processed`);
      return received;
    }

    // Stripe side effects run only after the commit; sendRefund never throws.
    await sendRefunds(result.refundIds);

    const line = `Stripe webhook event ${event.id} (${event.type}) booking ${result.bookingId} payment ${result.paymentId}: ${result.outcome}`;
    if (result.error) logger.warn(`${line} (${result.error})`);
    else logger.info(line);
    return received;
  } catch (error) {
    // AC-11: a problem a retry can fix. processedAt stays null and Stripe sends the event again.
    const message = errorText(error);
    await prisma.stripeWebhookEvent
      .update({ where: { id: event.id }, data: { error: message } })
      .catch(writeError =>
        logger.error(
          `Could not store error for Stripe webhook event ${event.id}: ${errorText(writeError)}`,
        ),
      );
    logger.error(`Stripe webhook event ${event.id} (${event.type}) failed, Stripe will retry: ${message}`);
    return { status: StatusCodes.INTERNAL_SERVER_ERROR, body: { error: 'Webhook processing failed' } };
  }
};

export const handleStripeWebhook = async (
  rawBody: unknown,
  signature: string | string[] | undefined,
): Promise<WebhookResponse> => {
  const verified = verifyEvent(rawBody, signature);
  if ('response' in verified) return verified.response;
  return processEvent(verified.event);
};
