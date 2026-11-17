import {
  BookingStatus,
  PaymentProvider,
  RefundStatus,
  TripStatus,
} from '@prisma/client';
import { refundableCents } from '../booking/booking.policy';

/**
 * Spec 0006: every money rule of the admin payments page lives here, so the three tabs, the
 * drill down, and the CSV can never disagree. Integers (cents) only.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type MoneySplit = {
  gross: number;
  refunded: number;
  commissionNet: number;
  operatorNet: number;
};

/**
 * AC-6. Refunded is capped at the amount; the operator gives back its share of the refund,
 * rounded half up in integers; commission takes the remainder, so
 * commissionNet + operatorNet = gross − refunded exactly.
 */
export const splitNet = (amount: number, operatorCents: number, countedRefunds: number): MoneySplit => {
  if (amount <= 0) return { gross: 0, refunded: 0, commissionNet: 0, operatorNet: 0 };
  const refunded = Math.min(Math.max(countedRefunds, 0), amount);
  const operatorRefund = Math.floor((2 * refunded * operatorCents + amount) / (2 * amount));
  const operatorNet = operatorCents - operatorRefund;
  return { gross: amount, refunded, commissionNet: amount - refunded - operatorNet, operatorNet };
};

export const addSplit = (total: MoneySplit, item: MoneySplit): MoneySplit => ({
  gross: total.gross + item.gross,
  refunded: total.refunded + item.refunded,
  commissionNet: total.commissionNet + item.commissionNet,
  operatorNet: total.operatorNet + item.operatorNet,
});

export const ZERO_SPLIT: MoneySplit = { gross: 0, refunded: 0, commissionNet: 0, operatorNet: 0 };

/** Money the platform really collected through Stripe (COMPLETED, PARTIALLY_REFUNDED, REFUNDED). */
export const isPaid = (payment: { provider: PaymentProvider; paidAt: Date | null }) =>
  payment.provider === PaymentProvider.STRIPE && payment.paidAt !== null;

/** A refund that has left or is leaving; a FAILED one never counts (AC-5). */
export const isCountedRefund = (refund: { status: RefundStatus }) =>
  refund.status === RefundStatus.SUCCEEDED || refund.status === RefundStatus.PENDING;

export const countedRefundCents = (refunds: { status: RefundStatus; amountCents: number }[]) =>
  refunds.filter(isCountedRefund).reduce((sum, refund) => sum + refund.amountCents, 0);

/** AC-5: paid, booking still live, outbound trip not cancelled and already sailed. */
export const isPayoutCounted = (
  payment: { provider: PaymentProvider; paidAt: Date | null },
  booking: { status: BookingStatus },
  schedule: { status: TripStatus; departureTime: Date },
  now: Date,
) =>
  isPaid(payment) &&
  booking.status !== BookingStatus.CANCELLED &&
  booking.status !== BookingStatus.EXPIRED &&
  schedule.status !== TripStatus.CANCELLED &&
  schedule.departureTime.getTime() <= now.getTime();

export type DayRange = { from?: string; to?: string };

/** The UTC window of the inclusive day range: `from` 00:00Z up to the day after `to`. */
export const utcWindow = ({ from, to }: DayRange): { gte?: Date; lt?: Date } => ({
  ...(from ? { gte: new Date(Date.parse(`${from}T00:00:00Z`) ) } : {}),
  ...(to ? { lt: new Date(Date.parse(`${to}T00:00:00Z`) + DAY_MS) } : {}),
});

/** The instant's UTC day, inside the inclusive range (a missing side is open). */
export const inDayRange = (instant: Date, { from, to }: DayRange) => {
  if (!from && !to) return true;
  const day = instant.toISOString().slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
};

type RetryRefund = { id: string; status: RefundStatus; createdAt: Date };

/**
 * AC-4, the spec 0004 rule: FAILED, the payment's latest refund, and something left to refund
 * (`refundableCents` from booking.policy, the same function the retry endpoint uses).
 */
export const canRetryRefund = (
  refund: RetryRefund,
  payment: Parameters<typeof refundableCents>[0] & { refunds: RetryRefund[] },
) => {
  if (refund.status !== RefundStatus.FAILED || !payment) return false;
  const latest = [...payment.refunds].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
  )[0];
  return latest?.id === refund.id && refundableCents(payment) > 0;
};
