import { Payment, Refund } from '@prisma/client';
import { USER_ROLES } from '../../../enums/user';

/**
 * Spec 0001: payment money math and role based payment exposure for bookings.
 * All payment money is integer cents. Fares stay Float dollars until the fares migration.
 */

export type IBookingAmounts = {
  amountCents: number;
  /** Booking.totalAmount in dollars, derived from amountCents so the two never drift. */
  totalAmount: number;
  commissionRate: number;
  platformCommissionCents: number;
  operatorPayoutCents: number;
};

export const calculateBookingAmounts = (input: {
  adultsCount: number;
  childrenCount: number;
  adultFare: number;
  childFare: number;
  commissionRate: number;
}): IBookingAmounts => {
  const amountCents = Math.round(
    (input.adultsCount * input.adultFare + input.childrenCount * input.childFare) * 100,
  );
  const platformCommissionCents = Math.round(
    (amountCents * input.commissionRate) / 100,
  );

  return {
    amountCents,
    totalAmount: amountCents / 100,
    commissionRate: input.commissionRate,
    platformCommissionCents,
    operatorPayoutCents: amountCents - platformCommissionCents,
  };
};

/** Who is looking at a booking. A guest is a CUSTOMER with no account. */
export type PaymentViewer = 'ADMIN' | 'OPERATOR' | 'CUSTOMER';

export const viewerFromRole = (role?: string | null): PaymentViewer => {
  if (role === USER_ROLES.ADMIN) return 'ADMIN';
  if (role === USER_ROLES.OPERATOR) return 'OPERATOR';
  return 'CUSTOMER';
};

type PaymentWithRefunds = Payment & { refunds?: Refund[] };

const serializeRefunds = (refunds: Refund[] | undefined, viewer: PaymentViewer) =>
  (refunds ?? []).map(refund =>
    viewer === 'ADMIN'
      ? refund
      : {
          amountCents: refund.amountCents,
          status: refund.status,
          createdAt: refund.createdAt,
        },
  );

/**
 * The only place payment fields are shaped for a response (spec 0001, AC-7).
 * Deprecated Float columns and transactionId are never returned.
 */
export const serializePayment = (
  payment: PaymentWithRefunds | null | undefined,
  viewer: PaymentViewer,
) => {
  if (!payment) return null;

  const customerView = {
    status: payment.status,
    amountCents: payment.amountCents,
    currency: payment.currency,
    paidAt: payment.paidAt,
    refunds: serializeRefunds(payment.refunds, viewer),
  };

  if (viewer === 'CUSTOMER') return customerView;

  if (viewer === 'OPERATOR') {
    return { ...customerView, operatorPayoutCents: payment.operatorPayoutCents };
  }

  return {
    id: payment.id,
    ...customerView,
    provider: payment.provider,
    paymentMethod: payment.paymentMethod,
    commissionRate: payment.commissionRate,
    platformCommissionCents: payment.platformCommissionCents,
    operatorPayoutCents: payment.operatorPayoutCents,
    stripePaymentIntentId: payment.stripePaymentIntentId,
    lastFailureCode: payment.lastFailureCode,
    lastFailureMessage: payment.lastFailureMessage,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
};

/** Returns the booking with its payment shaped for the viewer. */
export const serializeBooking = <T extends { payment?: PaymentWithRefunds | null }>(
  booking: T,
  viewer: PaymentViewer,
) => ({
  ...booking,
  payment: serializePayment(booking.payment, viewer),
});

export const emailsMatch = (a?: string | null, b?: string | null): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
