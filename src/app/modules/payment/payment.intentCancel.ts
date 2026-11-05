import Stripe from 'stripe';
import { stripe } from '../../../config/stripe';
import { logger } from '../../../shared/logger';
import { ApplyIntentSource } from './payment.interface';
import { PaymentService } from './payment.service';

/**
 * Spec 0002, seat hold child: cancels a payment's PaymentIntent in Stripe after our own
 * transaction committed (an expired hold, or a customer cancel of a PENDING booking).
 *
 * Never throws. When Stripe refuses because the intent is no longer cancellable, a fresh
 * retrieve decides what to do, by `error.code` and the real intent status, never message text:
 * `succeeded` → applied as a late payment (AC-14, AC-15); `canceled` or `processing` → nothing
 * (a processing intent settles through its webhook).
 */
export const cancelPaymentIntentAfterCommit = async (
  payment: { id: string; bookingId: string; stripePaymentIntentId: string | null },
  source: Extract<ApplyIntentSource, 'expiry' | 'cancel'>,
): Promise<void> => {
  const intentId = payment.stripePaymentIntentId;
  if (!intentId) return;

  const ids = `booking ${payment.bookingId} payment ${payment.id} intent ${intentId}`;

  if (!stripe) {
    logger.warn(`STRIPE_SECRET_KEY not set, PaymentIntent cancel skipped for ${ids}`);
    return;
  }

  try {
    await stripe.paymentIntents.cancel(intentId, {}, { idempotencyKey: `pi-cancel-${payment.id}` });
    logger.info(`PaymentIntent cancelled (${source}) for ${ids}`);
    return;
  } catch (error) {
    if (
      !(error instanceof Stripe.errors.StripeError) ||
      error.code !== 'payment_intent_unexpected_state'
    ) {
      logger.error(
        `PaymentIntent cancel (${source}) failed for ${ids}: ${
          error instanceof Stripe.errors.StripeError
            ? `${error.type} ${error.code ?? ''}`
            : (error as Error)?.message
        }`,
      );
      return;
    }
  }

  try {
    const intent = await stripe.paymentIntents.retrieve(intentId);
    if (intent.status === 'succeeded') {
      const result = await PaymentService.applyIntentResult(intent, source);
      logger.warn(`PaymentIntent had already succeeded (${source}) for ${ids}: ${result.outcome}`);
    } else {
      logger.info(`PaymentIntent not cancellable (${source}) for ${ids}: ${intent.status}`);
    }
  } catch (error) {
    // The webhook still delivers a real success, so nothing is lost here.
    logger.error(
      `PaymentIntent fallback (${source}) failed for ${ids}: ${(error as Error)?.message}`,
    );
  }
};
