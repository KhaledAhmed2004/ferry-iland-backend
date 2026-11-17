import { CsvColumn, centsToDollarText, toCsv } from './adminPayments.csv';
import type { IAdminPaymentRow, IAdminRefundRow } from './adminPayments.service';

/** Spec 0006, AC-8: the CSV columns of each tab, in the order of the row fields. */

const iso = (instant: Date | null) => (instant ? instant.toISOString() : '');
const money = <T>(header: string, value: (row: T) => number): CsvColumn<T> => ({
  header,
  value: row => centsToDollarText(value(row)),
  money: true,
});

export const paymentsCsv = (rows: IAdminPaymentRow[]) =>
  toCsv(rows, [
    { header: 'Booking reference', value: r => r.bookingReference },
    { header: 'Lead passenger', value: r => r.leadPassengerName },
    { header: 'Operator', value: r => r.operatorName },
    { header: 'Route', value: r => r.route },
    { header: 'Trip departure (UTC)', value: r => iso(r.tripDepartureTime) },
    { header: 'Provider', value: r => r.provider },
    { header: 'Status', value: r => r.status },
    money('Amount', r => r.amountCents),
    money('Refunded', r => r.refundedCents),
    money('Commission', r => r.commissionCents),
    money('Operator share', r => r.operatorPayoutCents),
    { header: 'Currency', value: r => r.currency.toUpperCase() },
    { header: 'Stripe payment', value: r => r.stripePaymentIntentId },
    { header: 'Paid (UTC)', value: r => iso(r.paidAt) },
    { header: 'Created (UTC)', value: r => iso(r.createdAt) },
  ]);

export const refundsCsv = (rows: IAdminRefundRow[]) =>
  toCsv(rows, [
    { header: 'Booking reference', value: r => r.bookingReference },
    { header: 'Lead passenger', value: r => r.leadPassengerName },
    { header: 'Operator', value: r => r.operatorName },
    money('Amount', r => r.amountCents),
    { header: 'Currency', value: r => r.currency.toUpperCase() },
    { header: 'Status', value: r => r.status },
    { header: 'Reason', value: r => r.reason },
    { header: 'Stripe refund', value: r => r.stripeRefundId },
    { header: 'Stripe payment', value: r => r.stripePaymentIntentId },
    { header: 'Failure', value: r => r.failureMessage },
    { header: 'Requested by', value: r => r.requestedByName },
    { header: 'Created (UTC)', value: r => iso(r.createdAt) },
    { header: 'Processed (UTC)', value: r => iso(r.processedAt) },
  ]);

type PayoutRow = {
  operatorName: string;
  bookings: number;
  grossCents: number;
  refundedCents: number;
  commissionNetCents: number;
  operatorNetCents: number;
};

export const payoutsCsv = (rows: PayoutRow[]) =>
  toCsv(rows, [
    { header: 'Operator', value: r => r.operatorName },
    { header: 'Bookings', value: r => r.bookings },
    money('Gross', r => r.grossCents),
    money('Refunded', r => r.refundedCents),
    money('Commission net', r => r.commissionNetCents),
    money('Operator net', r => r.operatorNetCents),
  ]);

type PayoutBookingRow = {
  bookingReference: string;
  route: string;
  tripDepartureTime: Date;
  leadPassengerName: string;
  paymentStatus: string;
  stripePaymentIntentId: string | null;
  grossCents: number;
  refundedCents: number;
  commissionNetCents: number;
  operatorNetCents: number;
};

export const payoutBookingsCsv = (rows: PayoutBookingRow[]) =>
  toCsv(rows, [
    { header: 'Trip departure (UTC)', value: r => iso(r.tripDepartureTime) },
    { header: 'Booking reference', value: r => r.bookingReference },
    { header: 'Route', value: r => r.route },
    { header: 'Lead passenger', value: r => r.leadPassengerName },
    { header: 'Payment status', value: r => r.paymentStatus },
    money('Gross', r => r.grossCents),
    money('Refunded', r => r.refundedCents),
    money('Commission net', r => r.commissionNetCents),
    money('Operator net', r => r.operatorNetCents),
    { header: 'Stripe payment', value: r => r.stripePaymentIntentId },
  ]);
