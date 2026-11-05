import Stripe from 'stripe';
import { BookingStatus, Payment, PaymentProvider, PaymentStatus, RefundStatus } from '@prisma/client';
import config from '../../../config';
import { stripe } from '../../../config/stripe';
import { prisma } from '../../../shared/prisma';
import { logger } from '../../../shared/logger';
import { cancelPaymentIntentAfterCommit } from './payment.intentCancel';
import { sendRefunds } from './payment.refund';
import { PaymentService } from './payment.service';
import { releaseBookingSeats } from '../booking/booking.seats';

/**
 * Spec 0002, seat hold expiry child (AC-13, AC-17, AC-19). An in process job: every minute it
 * expires unpaid STRIPE bookings whose hold ended, gives their seats back, cancels their
 * PaymentIntent in Stripe, and resends refunds a crash left without a Stripe call.
 *
 * Correct with overlapping ticks or several servers: every status change is a conditional
 * updateMany, and seats return only when that update changed exactly one row.
 */

export const HOLD_EXPIRY_INTERVAL_MS = 60_000;
export const HOLD_EXPIRY_BATCH_SIZE = 100;
/** Extra time for a customer in the middle of a bank check (3DS) when the hold ends. */
export const THREE_DS_GRACE_MS = 5 * 60_000;
export const REFUND_SWEEP_BATCH_SIZE = 50;
export const REFUND_SWEEP_MIN_AGE_MS = 5 * 60_000;

/** Intent statuses that mean the customer may still be finishing the payment. */
const GRACE_INTENT_STATUSES: Stripe.PaymentIntent.Status[] = ['processing', 'requires_action'];

export type ExpireOutcome = 'expired' | 'grace' | 'applied' | 'unchanged' | 'error';

type ExpirableBooking = {
  id: string;
  scheduleId: string;
  returnScheduleId?: string | null;
  adultsCount: number;
  childrenCount: number;
  holdExpiresAt: Date | null;
  payment: Payment | null;
};

/**
 * Before expiring, Stripe is asked about a stored intent: a succeeded one is applied instead
 * (AC-14), and one still in a bank check gets the 3DS grace window (AC-13). When Stripe cannot
 * be reached (or no key is set) the booking expires anyway; a late success is still handled.
 */
const checkIntentBeforeExpiring = async (
  booking: ExpirableBooking,
  now: Date,
): Promise<'expire' | 'grace' | 'applied'> => {
  const intentId = booking.payment?.stripePaymentIntentId;
  if (!intentId || !stripe) return 'expire';

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(intentId);
  } catch (error) {
    logger.warn(
      `Hold expiry could not retrieve intent ${intentId} for booking ${booking.id}, expiring anyway: ${
        error instanceof Stripe.errors.StripeError ? error.type : (error as Error)?.message
      }`,
    );
    return 'expire';
  }

  if (intent.status === 'succeeded') {
    await PaymentService.applyIntentResult(intent, 'expiry');
    return 'applied';
  }

  const endedMsAgo = now.getTime() - (booking.holdExpiresAt?.getTime() ?? 0);
  if (GRACE_INTENT_STATUSES.includes(intent.status) && endedMsAgo < THREE_DS_GRACE_MS) {
    return 'grace';
  }
  return 'expire';
};

/** Expires one booking. Exported for tests; the job calls it through expireHolds. */
export const expireBooking = async (
  booking: ExpirableBooking,
  now: Date = new Date(),
): Promise<ExpireOutcome> => {
  const check = await checkIntentBeforeExpiring(booking, now);
  if (check !== 'expire') return check;

  const expired = await prisma.$transaction(async tx => {
    const changed = await tx.booking.updateMany({
      where: { id: booking.id, status: BookingStatus.PENDING, holdExpiresAt: { lt: now } },
      data: { status: BookingStatus.EXPIRED, expiredAt: now },
    });
    // Another tick, another server, a payment or a cancel got here first.
    if (changed.count !== 1) return false;

    await releaseBookingSeats(tx, booking);
    if (booking.payment) {
      await tx.payment.updateMany({
        where: { id: booking.payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.CANCELED },
      });
    }
    return true;
  });

  if (!expired) return 'unchanged';

  logger.info(`Booking ${booking.id} hold expired, seats returned`);
  if (booking.payment) {
    await cancelPaymentIntentAfterCommit(booking.payment, 'expiry');
  }
  return 'expired';
};

/** AC-13: one batch of overdue STRIPE holds, oldest first. */
export const expireHolds = async (now: Date = new Date()): Promise<ExpireOutcome[]> => {
  const overdue = await prisma.booking.findMany({
    where: {
      status: BookingStatus.PENDING,
      holdExpiresAt: { lt: now },
      payment: { provider: PaymentProvider.STRIPE },
    },
    orderBy: { holdExpiresAt: 'asc' },
    take: HOLD_EXPIRY_BATCH_SIZE,
    select: {
      id: true,
      scheduleId: true,
      returnScheduleId: true,
      adultsCount: true,
      childrenCount: true,
      holdExpiresAt: true,
      payment: true,
    },
  });

  const outcomes: ExpireOutcome[] = [];
  for (const booking of overdue) {
    try {
      outcomes.push(await expireBooking(booking, now));
    } catch (error) {
      // One bad row never stops the batch; it is picked up again next tick.
      logger.error(`Hold expiry failed for booking ${booking.id}: ${(error as Error)?.message}`);
      outcomes.push('error');
    }
  }
  return outcomes;
};

/**
 * AC-19: a Refund still PENDING with no Stripe id after 5 minutes means the process stopped
 * between the commit and the Stripe call. It is resent with its original idempotency key, so
 * Stripe returns the first refund if one was already made. FAILED refunds are never retried.
 */
export const sweepPendingRefunds = async (now: Date = new Date()): Promise<string[]> => {
  const stuck = await prisma.refund.findMany({
    where: {
      status: RefundStatus.PENDING,
      stripeRefundId: null,
      createdAt: { lt: new Date(now.getTime() - REFUND_SWEEP_MIN_AGE_MS) },
    },
    orderBy: { createdAt: 'asc' },
    take: REFUND_SWEEP_BATCH_SIZE,
    select: { id: true },
  });
  const ids = stuck.map(refund => refund.id);
  if (ids.length > 0) {
    logger.warn(`Refund sweep resending ${ids.length} stuck refund(s)`);
    await sendRefunds(ids);
  }
  return ids;
};

let running = false;

/** One job run: expire holds, then sweep refunds. Skips while the previous run is still going. */
export const tick = async (now: Date = new Date()): Promise<void> => {
  if (running) return;
  running = true;
  try {
    if (!stripe) {
      logger.warn('STRIPE_SECRET_KEY not set, hold expiry runs without Stripe calls');
    }
    await expireHolds(now);
    await sweepPendingRefunds(now);
  } catch (error) {
    logger.error(`Hold expiry tick failed: ${(error as Error)?.message}`);
  } finally {
    running = false;
  }
};

/**
 * AC-17: started from server.ts in every environment except NODE_ENV=test (tests call tick
 * directly), whatever PAYMENTS_ENABLED says, so holds made before a switch off still expire.
 */
export const startHoldExpiryJob = (): ReturnType<typeof setInterval> | null => {
  if (config.node_env === 'test') return null;
  const timer = setInterval(() => void tick(), HOLD_EXPIRY_INTERVAL_MS);
  timer.unref();
  logger.info(`Hold expiry job started (every ${HOLD_EXPIRY_INTERVAL_MS / 1000}s)`);
  return timer;
};
