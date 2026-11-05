import type { BookingStatus } from '@prisma/client';

/** Who is asking: admin, the owning account, or a guest proving the lead passenger email. */
export type IPaymentRequester = {
  userId: string | null;
  role?: string | null;
  email?: string | null;
};

export type ICreatePaymentIntentPayload = {
  bookingId: string;
  email?: string;
};

/** Body of a 200 from POST /payments/intent (spec 0002, AC-1). */
export type IPaymentIntentResponse = {
  bookingId: string;
  bookingReference: string;
  clientSecret: string;
  amountCents: number;
  currency: string;
  holdExpiresAt: Date;
  /** Server clock at response time, so the browser can correct its countdown for clock skew (AC-5). */
  serverNow: Date;
};

/**
 * Machine readable reason on a 409 from the intent endpoint, so the page knows where to go.
 * Sent as `data.code` next to `data.bookingStatus`.
 */
export type PaymentConflictCode =
  | 'BOOKING_NOT_PENDING'
  | 'HOLD_EXPIRED'
  | 'PAYMENT_PROCESSING'
  | 'PAYMENT_SUCCEEDED';

export type IPaymentConflictData = {
  code: PaymentConflictCode;
  bookingStatus: BookingStatus;
  bookingReference: string;
};

/** Which caller handed a Stripe result to applyIntentResult. */
export type ApplyIntentSource = 'webhook' | 'sync' | 'intent' | 'expiry' | 'cancel';

export type ApplyIntentOutcome =
  /** Booking PENDING (or EXPIRED with seats still free) → CONFIRMED and payment → COMPLETED. */
  | 'confirmed'
  /**
   * Money arrived for an EXPIRED booking that could not take its seats again, or for a
   * CANCELLED booking: payment COMPLETED and a full Refund queued (spec 0002, AC-14, AC-15).
   */
  | 'late_refund'
  /** Already applied by an earlier call; nothing changed. */
  | 'duplicate'
  /** The intent has not succeeded; nothing to apply. */
  | 'not_succeeded'
  /** A problem a retry cannot fix; `error` says why and nothing was confirmed. */
  | 'error';

export type IApplyIntentResult = {
  outcome: ApplyIntentOutcome;
  paymentId: string | null;
  bookingId: string | null;
  /** Set for outcome `error`; the webhook stores it on the event row (AC-11). */
  error?: string;
};

/** applyIntentResult run inside a caller's transaction, plus the refunds to send after commit. */
export type IApplyIntentTxResult = {
  result: IApplyIntentResult;
  refundIds: string[];
};

/** What one webhook event handler did; stored on the StripeWebhookEvent row (AC-8, AC-11). */
export type IWebhookHandlerResult = {
  outcome: string;
  paymentId: string | null;
  bookingId: string | null;
  /** A problem a retry cannot fix: the event is still marked processed, with this reason. */
  error?: string;
  /** Refunds created in the transaction, sent to Stripe after it commits. */
  refundIds: string[];
};
