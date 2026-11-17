import {
  Booking,
  BookingStatus,
  Payment,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  Refund,
  RefundReason,
  RefundStatus,
} from '@prisma/client';
import { logger } from '../../../shared/logger';
import { claimBooking, isUniqueViolation, policyError, refundableCents } from './booking.policy';
import { releaseBookingSeats } from './booking.seats';

type BookingToCancel = Booking & { payment: (Payment & { refunds: Refund[] }) | null };

/**
 * Spec 0004: the one cancel path inside a transaction, shared by the customer's self cancel, the
 * admin's direct cancel, and a staff resolved CANCEL request. It claims the booking (compare and
 * swap, AC-13), gives the seats back on every leg, cancels an uncollected payment, and writes the
 * refund row for collected Stripe money (AC-1, AC-8, AC-20). The caller sends the returned refund
 * ids to Stripe after commit with `sendRefunds`.
 */
export const applyCancellation = async (
  tx: Prisma.TransactionClient,
  booking: BookingToCancel,
  options: { reason: RefundReason; actorUserId: string | null; now: Date },
): Promise<{ refundIds: string[] }> => {
  await claimBooking(tx, booking, {
    status: BookingStatus.CANCELLED,
    cancelledAt: options.now,
  });

  // Outbound and, for a return trip, the return leg too.
  await releaseBookingSeats(tx, booking);

  // Nothing was collected yet, so the payment is simply cancelled.
  if (booking.payment?.status === PaymentStatus.PENDING) {
    await tx.payment.update({
      where: { id: booking.payment.id },
      data: { status: PaymentStatus.CANCELED },
    });
  }

  // Collected money always ends in a record: the refund row is written in this transaction.
  const refundIds: string[] = [];
  const amountCents = refundableCents(booking.payment);
  if (booking.payment && amountCents > 0) {
    try {
      const refund = await tx.refund.create({
        data: {
          paymentId: booking.payment.id,
          amountCents,
          reason: options.reason,
          status: RefundStatus.PENDING,
          requestedByUserId: options.actorUserId,
        },
      });
      refundIds.push(refund.id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw policyError('REFUND_EXISTS', 'A refund for this booking is already in progress');
      }
      throw error;
    }
  } else if (
    booking.status === BookingStatus.CONFIRMED &&
    booking.payment &&
    booking.payment.provider !== PaymentProvider.STRIPE
  ) {
    logger.warn(
      `Booking ${booking.reference} cancelled with a ${booking.payment.provider} payment: refund it by hand`,
    );
  }

  return { refundIds };
};
