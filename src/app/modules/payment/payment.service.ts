import { StatusCodes } from 'http-status-codes';
import Stripe from 'stripe';
import {
  Booking,
  BookingStatus,
  Payment,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  RefundReason,
  RefundStatus,
} from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { logger } from '../../../shared/logger';
import {
  ALLOWED_PAYMENT_METHOD_TYPES,
  STRIPE_MINIMUM_AMOUNT_CENTS,
  isLiveStripeKey,
  stripe,
} from '../../../config/stripe';
import { emailsMatch, serializeBooking } from '../booking/booking.payment';
import { bookingDetailInclude, isTripOpenForBooking } from '../booking/booking.service';
import { bookingScheduleIds, bookingSeatCount, takeSeats } from '../booking/booking.seats';
import {
  ApplyIntentSource,
  IApplyIntentResult,
  IApplyIntentTxResult,
  ICreatePaymentIntentPayload,
  IPaymentConflictData,
  IPaymentIntentResponse,
  IPaymentRequester,
  PaymentConflictCode,
} from './payment.interface';
import { sendRefunds } from './payment.refund';

/**
 * Spec 0002. Real card payments through Stripe PaymentIntents.
 *
 * Only applyIntentResult may move a STRIPE payment to COMPLETED, and only after Stripe itself
 * (a signed webhook, or our own paymentIntents.retrieve) says the intent succeeded.
 */

/** Payment statuses that mean the money was already applied (step 1 of applyIntentResult). */
const ALREADY_APPLIED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.COMPLETED,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

/** Payment statuses a succeeded intent may still be applied to. */
const APPLICABLE_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.CANCELED,
];

const PAYMENT_SERVICE_UNAVAILABLE = 'Payment service unavailable, try again';

type BookingWithPayment = Booking & { payment: Payment | null };

const getStripeClient = (): Stripe => {
  if (!stripe) {
    logger.error('Stripe call attempted without STRIPE_SECRET_KEY');
    throw new ApiError(StatusCodes.BAD_GATEWAY, PAYMENT_SERVICE_UNAVAILABLE);
  }
  return stripe;
};

const isStripeError = (error: unknown): error is Stripe.errors.StripeError =>
  error instanceof Stripe.errors.StripeError;

/** Any Stripe failure on the checkout path is a 502: the booking keeps its hold and the customer retries. */
const toStripeUnavailable = (
  error: unknown,
  action: string,
  ids: { bookingId: string; paymentId: string },
) => {
  if (error instanceof ApiError) return error;
  logger.error(
    `Stripe ${action} failed for booking ${ids.bookingId} payment ${ids.paymentId}: ${
      isStripeError(error) ? `${error.type} ${error.code ?? ''}` : (error as Error)?.message
    }`,
  );
  return new ApiError(StatusCodes.BAD_GATEWAY, PAYMENT_SERVICE_UNAVAILABLE);
};

const conflict = (
  message: string,
  code: PaymentConflictCode,
  booking: Pick<Booking, 'status' | 'reference'>,
) => {
  const data: IPaymentConflictData = {
    code,
    bookingStatus: booking.status,
    bookingReference: booking.reference,
  };
  return new ApiError(StatusCodes.CONFLICT, message, '', data);
};

/**
 * Spec 0001's booking access rule, in spec 0002's AC-2 order: a guest with a missing or wrong
 * email gets 404 (nothing revealed), a signed in user asking for another account's booking 403.
 */
const loadAccessibleBooking = async (
  bookingId: string,
  requester: IPaymentRequester,
): Promise<{ booking: BookingWithPayment; isAdmin: boolean }> => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });

  if (!booking) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Booking not found');
  }

  const isAdmin = requester.role === 'ADMIN';
  const isOwner =
    !!booking.userId && !!requester.userId && booking.userId === requester.userId;
  const hasMatchingEmail = emailsMatch(booking.leadPassengerEmail, requester.email);

  if (!(isAdmin || isOwner || hasMatchingEmail)) {
    if (requester.userId && booking.userId) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        'You are not authorized to pay for this booking',
      );
    }
    throw new ApiError(StatusCodes.NOT_FOUND, 'Booking not found');
  }

  return { booking, isAdmin };
};

const intentResponse = (
  booking: BookingWithPayment,
  payment: Payment,
  clientSecret: string | null,
): IPaymentIntentResponse => {
  if (!clientSecret) {
    logger.error(`PaymentIntent for payment ${payment.id} has no client secret`);
    throw new ApiError(StatusCodes.BAD_GATEWAY, PAYMENT_SERVICE_UNAVAILABLE);
  }
  return {
    bookingId: booking.id,
    bookingReference: booking.reference,
    clientSecret,
    amountCents: payment.amountCents,
    currency: payment.currency,
    holdExpiresAt: booking.holdExpiresAt as Date,
    serverNow: new Date(),
  };
};

/**
 * POST /payments/intent (AC-1, AC-2). One PaymentIntent per booking, created on the first call
 * and reused for every retry; the amount always comes from the stored Payment, never the request.
 */
const createOrGetIntent = async (
  payload: ICreatePaymentIntentPayload,
  requester: IPaymentRequester,
): Promise<IPaymentIntentResponse> => {
  const { booking } = await loadAccessibleBooking(payload.bookingId, {
    ...requester,
    email: payload.email ?? requester.email,
  });
  const payment = booking.payment;

  if (!payment || payment.provider !== PaymentProvider.STRIPE) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'This booking is not paid through Stripe',
    );
  }

  if (payment.amountCents < STRIPE_MINIMUM_AMOUNT_CENTS) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'This booking is below the minimum card payment of $0.50',
    );
  }

  if (booking.status !== BookingStatus.PENDING) {
    throw conflict(
      `This booking is ${booking.status.toLowerCase().replace(/_/g, ' ')} and cannot be paid`,
      'BOOKING_NOT_PENDING',
      booking,
    );
  }

  const client = getStripeClient();
  const ids = { bookingId: booking.id, paymentId: payment.id };

  // A stored intent is asked first: a payment that succeeded just as the hold ran out
  // (for example a slow 3DS step) is applied, never answered with "hold expired".
  if (payment.stripePaymentIntentId) {
    let intent: Stripe.PaymentIntent;
    try {
      intent = await client.paymentIntents.retrieve(payment.stripePaymentIntentId);
    } catch (error) {
      throw toStripeUnavailable(error, 'paymentIntents.retrieve', ids);
    }
    return resolveExistingIntent(booking, payment, intent);
  }

  if (!isHoldActive(booking)) {
    throw conflict('Your seat hold has expired, start again', 'HOLD_EXPIRED', booking);
  }

  let intent: Stripe.PaymentIntent;
  try {
    intent = await client.paymentIntents.create(
      {
        amount: payment.amountCents,
        currency: payment.currency,
        allowed_payment_method_types: ALLOWED_PAYMENT_METHOD_TYPES,
        metadata: {
          bookingId: booking.id,
          paymentId: payment.id,
          bookingReference: booking.reference,
        },
      },
      // Same key on a retry returns the same intent, so a payment never gets a second one.
      { idempotencyKey: `pi-create-${payment.id}` },
    );
  } catch (error) {
    throw toStripeUnavailable(error, 'paymentIntents.create', ids);
  }

  // Save the id only if none is stored yet; a concurrent call with the same idempotency key
  // got the same intent, so a lost race still leaves the right id in place.
  const saved = await prisma.payment.updateMany({
    where: { id: payment.id, stripePaymentIntentId: null },
    data: { stripePaymentIntentId: intent.id },
  });

  if (saved.count !== 1) {
    const current = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (current.stripePaymentIntentId !== intent.id) {
      logger.error(
        `Payment ${payment.id} already holds intent ${current.stripePaymentIntentId}, Stripe returned ${intent.id}`,
      );
      throw new ApiError(StatusCodes.CONFLICT, 'Payment is already in progress, reload the page');
    }
  }

  logger.info(`PaymentIntent ${intent.id} created for booking ${booking.id} payment ${payment.id}`);
  return intentResponse(booking, payment, intent.client_secret);
};

/** A repeat call: the stored intent's status decides the answer (AC-1). */
const resolveExistingIntent = async (
  booking: BookingWithPayment,
  payment: Payment,
  intent: Stripe.PaymentIntent,
): Promise<IPaymentIntentResponse> => {
  switch (intent.status) {
    case 'succeeded': {
      await applyIntentResult(intent, 'intent');
      const fresh = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      // Claim success only when the booking really is confirmed. If applying failed (for
      // example an amount mismatch), the page waits on the confirmation screen instead.
      if (
        fresh.status === BookingStatus.CONFIRMED ||
        fresh.status === BookingStatus.CHECKED_IN
      ) {
        throw conflict('This booking is already paid', 'PAYMENT_SUCCEEDED', fresh);
      }
      throw conflict('Your payment is being checked', 'PAYMENT_PROCESSING', fresh);
    }
    case 'processing':
      throw conflict(
        'Your payment is processing',
        'PAYMENT_PROCESSING',
        booking,
      );
    case 'canceled':
      throw conflict('Your seat hold has expired, start again', 'HOLD_EXPIRED', booking);
    default:
      // Not paid yet: the hold decides whether the customer may still try.
      if (!isHoldActive(booking)) {
        throw conflict('Your seat hold has expired, start again', 'HOLD_EXPIRED', booking);
      }
      return intentResponse(booking, payment, intent.client_secret);
  }
};

const isHoldActive = (booking: Pick<Booking, 'holdExpiresAt'>): boolean =>
  !!booking.holdExpiresAt && booking.holdExpiresAt.getTime() > Date.now();

/**
 * POST /payments/:bookingId/sync (spec 0002, AC-12). Backup for a slow webhook: ask Stripe
 * directly and apply a succeeded intent through the same function. Best effort: when Stripe
 * cannot be reached the booking is returned as it is, and the webhook still settles it.
 */
const syncPayment = async (bookingId: string, requester: IPaymentRequester) => {
  const { booking, isAdmin } = await loadAccessibleBooking(bookingId, requester);
  const payment = booking.payment;

  if (
    payment?.provider === PaymentProvider.STRIPE &&
    payment.stripePaymentIntentId &&
    APPLICABLE_PAYMENT_STATUSES.includes(payment.status)
  ) {
    try {
      const intent = await getStripeClient().paymentIntents.retrieve(
        payment.stripePaymentIntentId,
      );
      if (intent.status === 'succeeded') {
        await applyIntentResult(intent, 'sync');
      }
    } catch (error) {
      logger.warn(
        `Payment sync could not reach Stripe for booking ${booking.id}: ${
          isStripeError(error) ? error.type : (error as Error)?.message
        }`,
      );
    }
  }

  const fresh = await prisma.booking.findUniqueOrThrow({
    where: { id: booking.id },
    include: bookingDetailInclude,
  });
  return serializeBooking(fresh, isAdmin ? 'ADMIN' : 'CUSTOMER');
};

type Db = Prisma.TransactionClient;

/** Finds our payment for an intent; the metadata fallback applies only while no id is stored. */
export const findPaymentForIntent = async (
  intent: Stripe.PaymentIntent,
  db: Db = prisma,
): Promise<{ payment: Payment | null; error?: string }> => {
  const byIntentId = await db.payment.findUnique({
    where: { stripePaymentIntentId: intent.id },
  });
  if (byIntentId) return { payment: byIntentId };

  const metadataPaymentId = intent.metadata?.paymentId;
  if (!metadataPaymentId) {
    return { payment: null, error: `unknown_payment: no payment for intent ${intent.id}` };
  }

  const byMetadata = await db.payment.findUnique({ where: { id: metadataPaymentId } });
  if (!byMetadata) {
    return { payment: null, error: `unknown_payment: metadata payment ${metadataPaymentId} not found` };
  }
  if (byMetadata.stripePaymentIntentId && byMetadata.stripePaymentIntentId !== intent.id) {
    return {
      payment: byMetadata,
      error: `intent_mismatch: payment holds ${byMetadata.stripePaymentIntentId}, event has ${intent.id}`,
    };
  }

  const saved = await db.payment.updateMany({
    where: { id: byMetadata.id, stripePaymentIntentId: null },
    data: { stripePaymentIntentId: intent.id },
  });
  if (saved.count !== 1) {
    const current = await db.payment.findUniqueOrThrow({ where: { id: byMetadata.id } });
    if (current.stripePaymentIntentId !== intent.id) {
      return {
        payment: current,
        error: `intent_mismatch: payment holds ${current.stripePaymentIntentId}, event has ${intent.id}`,
      };
    }
    return { payment: current };
  }
  return { payment: { ...byMetadata, stripePaymentIntentId: intent.id } };
};

/**
 * A late payment for an EXPIRED booking takes its seats again when the trip is still bookable
 * (open status, departure in the future) and enough seats are free (spec 0002, AC-14). Read and
 * written inside the transaction; the conditional decrement means seats are never oversold.
 * Returns true when the booking is CONFIRMED again.
 */
const retakeSeats = async (tx: Db, booking: Booking, now: Date): Promise<boolean> => {
  // Outbound and, for a return trip, the return leg: both must still be bookable, or neither is taken.
  const scheduleIds = bookingScheduleIds(booking);
  const schedules = await tx.schedule.findMany({ where: { id: { in: scheduleIds } } });
  const allBookable =
    schedules.length === scheduleIds.length &&
    schedules.every(
      schedule =>
        isTripOpenForBooking(schedule.status) &&
        schedule.departureTime.getTime() > now.getTime(),
    );
  if (!allBookable) return false;

  if (!(await takeSeats(tx, scheduleIds, bookingSeatCount(booking)))) return false;

  // expiredAt stays as the audit trail of the hold that ended.
  const confirmed = await tx.booking.updateMany({
    where: { id: booking.id, status: BookingStatus.EXPIRED },
    data: { status: BookingStatus.CONFIRMED, confirmedAt: now },
  });
  if (confirmed.count !== 1) {
    // Rolls back the payment and seat updates; a retry sees the real state.
    throw new Error(`Booking ${booking.id} changed while taking its seats again`);
  }
  return true;
};

/**
 * The one write path for a Stripe result (spec 0002, index contract), run inside the caller's
 * transaction. The webhook runs it inside its event row transaction, so the event is marked done
 * in the same commit as its effects. Refunds it creates come back in `refundIds`; the caller
 * sends them to Stripe after the commit (sendRefunds). Nothing else sets a STRIPE payment COMPLETED.
 *
 * Returns outcome `error` for problems a retry cannot fix. Throws only for problems a retry can
 * fix (database errors), so the webhook answers 500 and Stripe sends the event again.
 */
export const applyIntentResultInTx = async (
  tx: Db,
  intent: Stripe.PaymentIntent,
  source: ApplyIntentSource,
): Promise<IApplyIntentTxResult> => {
  const refundIds: string[] = [];
  const { payment, error: matchError } = await findPaymentForIntent(intent, tx);
  const base = { paymentId: payment?.id ?? null, bookingId: payment?.bookingId ?? null };
  const done = (result: IApplyIntentResult): IApplyIntentTxResult => ({ result, refundIds });

  const fail = (reason: string): IApplyIntentTxResult => {
    logger.error(
      `applyIntentResult (${source}) intent ${intent.id} booking ${base.bookingId} payment ${base.paymentId}: ${reason}`,
    );
    return done({ outcome: 'error', ...base, error: reason });
  };

  if (matchError || !payment) return fail(matchError ?? 'unknown_payment');

  if (intent.livemode !== isLiveStripeKey()) {
    return fail(`livemode_mismatch: intent livemode ${intent.livemode}`);
  }

  if (intent.status !== 'succeeded') {
    return done({ outcome: 'not_succeeded', ...base });
  }

  const current = await tx.payment.findUniqueOrThrow({
    where: { id: payment.id },
    include: { booking: true },
  });

  // Step 1: a repeat call never takes seats, confirms or refunds twice.
  if (ALREADY_APPLIED_PAYMENT_STATUSES.includes(current.status)) {
    return done({ outcome: 'duplicate', ...base });
  }
  if (!APPLICABLE_PAYMENT_STATUSES.includes(current.status)) {
    return fail(`unexpected_payment_status: ${current.status}`);
  }

  const now = new Date();
  const completePayment = () =>
    tx.payment.updateMany({
      where: { id: current.id, status: { in: APPLICABLE_PAYMENT_STATUSES } },
      data: {
        status: PaymentStatus.COMPLETED,
        paidAt: now,
        paymentMethod: 'card',
        lastFailureCode: null,
        lastFailureMessage: null,
      },
    });

  // Step 2: the money that arrived must be exactly what we asked for (AC-9). On a mismatch the
  // money is real, so the payment completes and is refunded in full (AC-18). The booking is left
  // as it is, and the expiry job releases it as usual.
  if (
    intent.amount_received !== current.amountCents ||
    intent.currency !== current.currency
  ) {
    const completed = await completePayment();
    if (completed.count !== 1) {
      // A concurrent caller handled this mismatch first.
      return done({ outcome: 'duplicate', ...base });
    }
    const refund = await tx.refund.create({
      data: {
        paymentId: current.id,
        amountCents: intent.amount_received,
        reason: RefundReason.ADMIN,
        status: RefundStatus.PENDING,
      },
    });
    refundIds.push(refund.id);
    return fail(
      `amount_mismatch: expected ${current.amountCents} ${current.currency} got ${intent.amount_received} ${intent.currency}`,
    );
  }

  // Step 3: by booking status.
  const booking = current.booking;

  if (booking.status === BookingStatus.EXPIRED || booking.status === BookingStatus.CANCELLED) {
    // The money is real, so the payment completes first. It is also the guard: only the caller
    // that moves it to COMPLETED may take seats or queue a refund (AC-14 repeat call rule).
    const completed = await completePayment();
    if (completed.count !== 1) return done({ outcome: 'duplicate', ...base });

    if (booking.status === BookingStatus.EXPIRED && (await retakeSeats(tx, booking, now))) {
      logger.info(
        `Expired booking ${booking.id} confirmed by a late payment (${source}), payment ${current.id} intent ${intent.id}`,
      );
      return done({ outcome: 'confirmed', ...base });
    }

    // Seats gone or trip no longer bookable (EXPIRED), or the customer cancelled (CANCELLED):
    // a booking the customer cancelled is never brought back.
    const reason =
      booking.status === BookingStatus.EXPIRED
        ? RefundReason.LATE_PAYMENT
        : RefundReason.CUSTOMER_CANCEL;
    const refund = await tx.refund.create({
      data: {
        paymentId: current.id,
        amountCents: current.amountCents,
        reason,
        status: RefundStatus.PENDING,
      },
    });
    refundIds.push(refund.id);
    logger.warn(
      `Late payment (${source}) for ${booking.status} booking ${booking.id}: payment ${current.id} completed, refund ${refund.id} ${reason} queued`,
    );
    return done({ outcome: 'late_refund', ...base });
  }

  if (booking.status !== BookingStatus.PENDING) {
    return fail(`unhandled_booking_status: ${booking.status}`);
  }

  const confirmed = await tx.booking.updateMany({
    where: { id: current.bookingId, status: BookingStatus.PENDING },
    data: { status: BookingStatus.CONFIRMED, confirmedAt: now },
  });
  if (confirmed.count !== 1) {
    // A concurrent caller confirmed it first.
    return done({ outcome: 'duplicate', ...base });
  }

  const completed = await completePayment();
  if (completed.count !== 1) {
    // Rolls back the booking update; a retry sees the real state.
    throw new Error(`Payment ${current.id} changed while confirming booking ${current.bookingId}`);
  }

  logger.info(
    `Booking ${current.bookingId} confirmed by ${source}, payment ${current.id} intent ${intent.id}`,
  );
  return done({ outcome: 'confirmed', ...base });
};

/** applyIntentResultInTx in its own transaction, then any refund it created goes to Stripe. */
const applyIntentResult = async (
  intent: Stripe.PaymentIntent,
  source: ApplyIntentSource,
): Promise<IApplyIntentResult> => {
  const { result, refundIds } = await prisma.$transaction(tx =>
    applyIntentResultInTx(tx, intent, source),
  );
  await sendRefunds(refundIds);
  return result;
};

export const PaymentService = {
  createOrGetIntent,
  syncPayment,
  applyIntentResult,
};
