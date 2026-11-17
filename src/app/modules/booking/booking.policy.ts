import { StatusCodes } from 'http-status-codes';
import {
  BookingRequest,
  BookingRequestStatus,
  BookingStatus,
  Payment,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  Refund,
  RefundStatus,
} from '@prisma/client';
import ApiError from '../../../errors/ApiError';

/**
 * Spec 0004: the cancel and change policy. One place for the 24h rule, the refundable amount,
 * the customer's cancellation view (the truth table), and the booking claim every seat or trip
 * change starts with.
 */

/** A customer may cancel with a refund until this many hours before the outbound departure. */
export const CANCEL_FREE_HOURS = 24;
/** Staff may move a leg until this many hours after its departure (no show moves). */
export const MOVE_GRACE_HOURS = 24;
/** Total requests (any state) a booking may ever have. */
export const MAX_REQUESTS_PER_BOOKING = 3;

const HOUR_MS = 60 * 60 * 1000;

/** Error codes the client can rely on (sent as `data.code`). */
export type BookingPolicyCode =
  | 'REQUEST_REQUIRED'
  | 'BOARDED'
  | 'BOOKING_CHANGED'
  | 'REFUND_EXISTS'
  | 'REQUEST_NOT_ALLOWED'
  | 'REQUEST_PENDING'
  | 'REQUEST_LIMIT'
  | 'REQUEST_NOT_PENDING'
  | 'MOVE_NOT_ALLOWED'
  | 'REFUND_NOT_FAILED'
  | 'NOTHING_TO_REFUND';

export const policyError = (code: BookingPolicyCode, message: string) =>
  new ApiError(StatusCodes.CONFLICT, message, '', { code });

export const cancelCutoff = (outboundDeparture: Date): Date =>
  new Date(outboundDeparture.getTime() - CANCEL_FREE_HOURS * HOUR_MS);

/** True while the customer may still cancel on their own (exactly 24h before counts). */
export const isWithinFreeCancel = (outboundDeparture: Date, now: Date): boolean =>
  now.getTime() <= cancelCutoff(outboundDeparture).getTime();

export const isWithinMoveWindow = (legDeparture: Date, now: Date): boolean =>
  now.getTime() <= legDeparture.getTime() + MOVE_GRACE_HOURS * HOUR_MS;

type PaymentWithRefunds = Payment & { refunds: Refund[] };

/** Only money Stripe actually collected can be refunded automatically. */
export const isAutoRefundable = (payment: Payment | null | undefined): boolean =>
  !!payment &&
  payment.provider === PaymentProvider.STRIPE &&
  payment.status === PaymentStatus.COMPLETED;

/**
 * What is still owed back: the amount collected minus every refund that has not failed.
 * Zero unless Stripe collected the money.
 */
export const refundableCents = (payment: PaymentWithRefunds | null | undefined): number => {
  if (!payment || !isAutoRefundable(payment)) return 0;
  const committed = payment.refunds
    .filter(refund => refund.status !== RefundStatus.FAILED)
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  return Math.max(0, payment.amountCents - committed);
};

export type RefundState = 'NONE' | 'PROCESSING' | 'REFUNDED' | 'FAILED';

export const refundStateOf = (payment: PaymentWithRefunds | null | undefined): RefundState => {
  const refunds = payment?.refunds ?? [];
  if (!payment || refunds.length === 0) return 'NONE';
  if (refunds.some(refund => refund.status === RefundStatus.PENDING)) return 'PROCESSING';
  const succeeded = refunds
    .filter(refund => refund.status === RefundStatus.SUCCEEDED)
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  if (succeeded >= payment.amountCents) return 'REFUNDED';
  const latest = [...refunds].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (latest.status === RefundStatus.FAILED && refundableCents(payment) > 0) return 'FAILED';
  return 'NONE';
};

export type CancellationMode = 'SELF_CANCEL' | 'REQUEST' | 'NONE';

export type RequestView = Pick<
  BookingRequest,
  'id' | 'type' | 'leg' | 'status' | 'reason' | 'staffNote' | 'createdAt' | 'resolvedAt'
>;

export type ICancellationInfo = {
  mode: CancellationMode;
  refundCents: number;
  cutoffAt: Date;
  /** false when the money was not collected by Stripe (manual or seeded); staff refund it. */
  automaticRefund: boolean;
  /** For mode REQUEST: the whole booking, or only the return leg of a checked in booking. */
  requestScope: 'BOOKING' | 'RETURN' | null;
  pendingRequest: RequestView | null;
  lastResolvedRequest: RequestView | null;
  refundState: RefundState;
};

export type BookingForPolicy = {
  status: BookingStatus;
  schedule: { departureTime: Date };
  returnSchedule?: { departureTime: Date } | null;
  payment?: PaymentWithRefunds | null;
  requests?: BookingRequest[];
};

export const toRequestView = (request: BookingRequest): RequestView => ({
  id: request.id,
  type: request.type,
  leg: request.leg,
  status: request.status,
  reason: request.reason,
  staffNote: request.staffNote,
  createdAt: request.createdAt,
  resolvedAt: request.resolvedAt,
});

/** The customer's cancellation view, the spec 0004 truth table (first matching row wins). */
export const getCancellationInfo = (
  booking: BookingForPolicy,
  now: Date = new Date(),
): ICancellationInfo => {
  const requests = booking.requests ?? [];
  const pending = requests.find(r => r.status === BookingRequestStatus.PENDING) ?? null;
  const lastResolved =
    requests
      .filter(r => r.status !== BookingRequestStatus.PENDING)
      .sort(
        (a, b) =>
          (b.resolvedAt ?? b.updatedAt).getTime() - (a.resolvedAt ?? a.updatedAt).getTime(),
      )[0] ?? null;
  const requestsLeft = requests.length < MAX_REQUESTS_PER_BOOKING;
  const outboundDeparture = booking.schedule.departureTime;
  const refundCents = refundableCents(booking.payment);

  const base = {
    refundCents,
    cutoffAt: cancelCutoff(outboundDeparture),
    automaticRefund: isAutoRefundable(booking.payment),
    pendingRequest: pending ? toRequestView(pending) : null,
    lastResolvedRequest: lastResolved ? toRequestView(lastResolved) : null,
    refundState: refundStateOf(booking.payment),
  };
  const none: ICancellationInfo = { ...base, mode: 'NONE', requestScope: null };

  if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.EXPIRED) {
    return none;
  }
  if (booking.status === BookingStatus.PENDING) {
    return { ...base, refundCents: 0, mode: 'SELF_CANCEL', requestScope: null };
  }
  if (pending) return none;

  if (booking.status === BookingStatus.CHECKED_IN) {
    const returnDeparture = booking.returnSchedule?.departureTime;
    if (returnDeparture && returnDeparture.getTime() > now.getTime() && requestsLeft) {
      return { ...base, refundCents: 0, mode: 'REQUEST', requestScope: 'RETURN' };
    }
    return { ...none, refundCents: 0 };
  }

  // CONFIRMED
  if (isWithinFreeCancel(outboundDeparture, now)) {
    return { ...base, mode: 'SELF_CANCEL', requestScope: null };
  }
  if (outboundDeparture.getTime() > now.getTime() && requestsLeft) {
    return { ...base, mode: 'REQUEST', requestScope: 'BOOKING' };
  }
  return none;
};

export type BookingSnapshot = {
  id: string;
  status: BookingStatus;
  scheduleId: string;
  returnScheduleId: string | null;
};

/**
 * Claims the booking for a change by compare and swap (AC-13): the update applies only if the
 * status and both trips are still what the caller read. A concurrent cancel, move, or check in
 * makes this throw 409 BOOKING_CHANGED, which rolls the caller's transaction back.
 */
export const claimBooking = async (
  tx: Prisma.TransactionClient,
  snapshot: BookingSnapshot,
  // Unchecked, so a move can point the booking at its new trips (scheduleId, returnScheduleId).
  data: Prisma.BookingUncheckedUpdateManyInput,
): Promise<void> => {
  const claimed = await tx.booking.updateMany({
    where: {
      id: snapshot.id,
      status: snapshot.status,
      scheduleId: snapshot.scheduleId,
      returnScheduleId: snapshot.returnScheduleId,
    },
    data,
  });
  if (claimed.count !== 1) {
    throw policyError(
      'BOOKING_CHANGED',
      'This booking was changed by someone else just now. Please reload and try again.',
    );
  }
};

/** Prisma unique violation (P2002), raised by the spec 0004 partial unique indexes. */
export const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
