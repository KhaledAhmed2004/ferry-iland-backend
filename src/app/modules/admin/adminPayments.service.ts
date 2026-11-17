import { Prisma, PaymentStatus, RefundReason, RefundStatus } from '@prisma/client';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { isLiveStripeKey } from '../../../config/stripe';
import {
  IAdminPaymentsQuery,
  IAdminPayoutBookingsQuery,
  IAdminPayoutsQuery,
  IAdminRefundsQuery,
  IListMeta,
  IMoneyTotals,
  SortOrder,
} from './admin.interface';
import {
  MoneySplit,
  ZERO_SPLIT,
  addSplit,
  canRetryRefund,
  countedRefundCents,
  inDayRange,
  isPaid,
  isPayoutCounted,
  splitNet,
  utcWindow,
} from './adminPayments.rules';
import { CSV_ROW_CAP } from './adminPayments.csv';

/**
 * Spec 0006: the read model behind the admin payments page. Rows are loaded with Prisma inside a
 * UTC day window, sorted, and
 * summed with the shared rules. Nothing here writes.
 */

const DEFAULT_LIMIT = 20;

const bookingContext = {
  select: {
    id: true,
    reference: true,
    leadPassengerName: true,
    status: true,
    schedule: {
      select: {
        id: true,
        departureTime: true,
        status: true,
        ferry: { select: { operator: { select: { id: true, companyName: true } } } },
        route: {
          select: {
            departurePort: { select: { name: true } },
            destinationPort: { select: { name: true } },
          },
        },
      },
    },
  },
} as const;

type BookingContext = Prisma.BookingGetPayload<typeof bookingContext>;

const stripeMode = (): 'live' | 'test' => (isLiveStripeKey() ? 'live' : 'test');
const routeOf = (booking: BookingContext) =>
  `${booking.schedule.route.departurePort.name} → ${booking.schedule.route.destinationPort.name}`;

const operatorWhere = (operatorId?: string): Prisma.BookingWhereInput =>
  operatorId ? { schedule: { ferry: { operatorId } } } : {};

const compare = (a: string | number | null, b: string | number | null) => {
  if (a === b) return 0;
  if (a === null) return 1; // nulls last in either order
  if (b === null) return -1;
  return a < b ? -1 : 1;
};

/** Sorts by the key in the order given, then by id ascending so pages are stable. */
const sortRows = <T extends { id: string }>(
  rows: T[],
  key: (row: T) => string | number | null,
  order: SortOrder,
) =>
  [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null || kb === null) return compare(ka, kb) || compare(a.id, b.id);
    return (order === 'asc' ? compare(ka, kb) : compare(kb, ka)) || compare(a.id, b.id);
  });

const paginate = <T>(rows: T[], page = 1, limit = DEFAULT_LIMIT) => {
  const total = rows.length;
  return {
    data: rows.slice((page - 1) * limit, page * limit),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), stripeMode: stripeMode() } satisfies IListMeta,
  };
};

const assertUnderCap = (count: number) => {
  if (count > CSV_ROW_CAP) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Narrow the filters, more than ${CSV_ROW_CAP} rows match`,
    );
  }
};

const totalsOf = (splits: MoneySplit[], bookings = splits.length): IMoneyTotals => {
  const sum = splits.reduce(addSplit, ZERO_SPLIT);
  return {
    bookings,
    grossCents: sum.gross,
    refundedCents: sum.refunded,
    commissionNetCents: sum.commissionNet,
    operatorNetCents: sum.operatorNet,
  };
};

// ---------------------------------------------------------------- Payments tab (AC-1, AC-2)

const loadPayments = async (query: IAdminPaymentsQuery) => {
  const window = utcWindow(query);
  const hasWindow = window.gte || window.lt;
  const search = query.search?.trim();
  const where: Prisma.PaymentWhereInput = {
    booking: operatorWhere(query.operatorId),
    ...(hasWindow
      ? { OR: [{ paidAt: window }, { paidAt: null, createdAt: window }] }
      : {}),
    ...(search
      ? {
          AND: [
            {
              OR: [
                { booking: { reference: { contains: search, mode: 'insensitive' } } },
                { booking: { leadPassengerName: { contains: search, mode: 'insensitive' } } },
                {
                  booking: {
                    schedule: {
                      ferry: { operator: { companyName: { contains: search, mode: 'insensitive' } } },
                    },
                  },
                },
              ],
            },
          ],
        }
      : {}),
  };
  const payments = await prisma.payment.findMany({
    where,
    include: { refunds: { select: { status: true, amountCents: true } }, booking: bookingContext },
  });
  return payments.filter(payment =>
    inDayRange(payment.paidAt ?? payment.createdAt, query),
  );
};

type LoadedPayment = Awaited<ReturnType<typeof loadPayments>>[number];

const paymentRow = (payment: LoadedPayment) => {
  const { booking } = payment;
  const operator = booking.schedule.ferry.operator;
  return {
    id: payment.id,
    bookingId: booking.id,
    bookingReference: booking.reference,
    leadPassengerName: booking.leadPassengerName,
    operatorId: operator.id,
    operatorName: operator.companyName,
    route: routeOf(booking),
    tripDepartureTime: booking.schedule.departureTime,
    provider: payment.provider,
    status: payment.status,
    amountCents: payment.amountCents,
    refundedCents: countedRefundCents(payment.refunds),
    commissionCents: payment.platformCommissionCents,
    operatorPayoutCents: payment.operatorPayoutCents,
    currency: payment.currency,
    stripePaymentIntentId: payment.stripePaymentIntentId,
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
  };
};

export type IAdminPaymentRow = ReturnType<typeof paymentRow>;

const PAYMENT_SORT: Record<string, (row: IAdminPaymentRow) => string | number | null> = {
  paidAt: row => row.paidAt?.getTime() ?? null,
  createdAt: row => row.createdAt.getTime(),
  amountCents: row => row.amountCents,
  refundedCents: row => row.refundedCents,
  status: row => row.status,
  bookingReference: row => row.bookingReference,
};

const buildPayments = async (query: IAdminPaymentsQuery) => {
  const payments = await loadPayments(query);

  // Cards: same date, operator and search filters, never the status filter; paid Stripe only.
  const paid = payments.filter(isPaid);
  const splits = paid.map(p =>
    splitNet(p.amountCents, p.operatorPayoutCents, countedRefundCents(p.refunds)),
  );
  const sum = splits.reduce(addSplit, ZERO_SPLIT);
  const overview = {
    collectedCents: sum.gross,
    refundedCents: sum.refunded,
    netCents: sum.gross - sum.refunded,
    commissionNetCents: sum.commissionNet,
    operatorNetCents: sum.operatorNet,
    currency: paid[0]?.currency ?? 'usd',
  };

  const rows = sortRows(
    payments.filter(p => !query.status || p.status === (query.status as PaymentStatus)).map(paymentRow),
    PAYMENT_SORT[query.sortBy ?? 'paidAt'],
    query.sortOrder ?? 'desc',
  );
  return { overview, rows };
};

const listPayments = async (query: IAdminPaymentsQuery) => {
  const { overview, rows } = await buildPayments(query);
  return { overview, ...paginate(rows, query.page, query.limit) };
};

const exportPayments = async (query: IAdminPaymentsQuery) => {
  const { rows } = await buildPayments(query);
  assertUnderCap(rows.length);
  return rows;
};

// ---------------------------------------------------------------- Refunds tab (AC-3, AC-4)

const loadRefunds = async (query: IAdminRefundsQuery) => {
  const window = utcWindow(query);
  const search = query.search?.trim();
  const refunds = await prisma.refund.findMany({
    where: {
      ...(window.gte || window.lt ? { createdAt: window } : {}),
      ...(query.status ? { status: query.status as RefundStatus } : {}),
      ...(query.reason ? { reason: query.reason as RefundReason } : {}),
      payment: { booking: operatorWhere(query.operatorId) },
      ...(search
        ? {
            OR: [
              { stripeRefundId: { contains: search, mode: 'insensitive' } },
              { payment: { booking: { reference: { contains: search, mode: 'insensitive' } } } },
              { payment: { booking: { leadPassengerName: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    },
    include: {
      requestedBy: { select: { name: true } },
      payment: { include: { refunds: true, booking: bookingContext } },
    },
  });
  return refunds.filter(refund =>
    inDayRange(refund.createdAt, query),
  );
};

type LoadedRefund = Awaited<ReturnType<typeof loadRefunds>>[number];

const refundRow = (refund: LoadedRefund) => {
  const { payment } = refund;
  const { booking } = payment;
  return {
    id: refund.id,
    paymentId: payment.id,
    bookingId: booking.id,
    bookingReference: booking.reference,
    leadPassengerName: booking.leadPassengerName,
    operatorName: booking.schedule.ferry.operator.companyName,
    amountCents: refund.amountCents,
    currency: payment.currency,
    status: refund.status,
    reason: refund.reason,
    stripeRefundId: refund.stripeRefundId,
    stripePaymentIntentId: payment.stripePaymentIntentId,
    failureMessage: refund.failureMessage,
    requestedByName: refund.requestedBy?.name ?? 'System',
    createdAt: refund.createdAt,
    processedAt: refund.processedAt,
    canRetry: canRetryRefund(refund, payment),
  };
};

export type IAdminRefundRow = ReturnType<typeof refundRow>;

const REFUND_SORT: Record<string, (row: IAdminRefundRow) => string | number | null> = {
  createdAt: row => row.createdAt.getTime(),
  amountCents: row => row.amountCents,
  status: row => row.status,
};

const buildRefunds = async (query: IAdminRefundsQuery) => {
  const rows = sortRows(
    (await loadRefunds(query)).map(refundRow),
    REFUND_SORT[query.sortBy ?? 'createdAt'],
    query.sortOrder ?? 'desc',
  );
  const amountCentsByStatus = Object.fromEntries(
    Object.values(RefundStatus).map(status => [
      status,
      rows.filter(r => r.status === status).reduce((sum, r) => sum + r.amountCents, 0),
    ]),
  ) as Record<RefundStatus, number>;
  const summary = { count: rows.length, amountCentsByStatus };
  return { summary, rows };
};

const listRefunds = async (query: IAdminRefundsQuery) => {
  const { summary, rows } = await buildRefunds(query);
  return { summary, ...paginate(rows, query.page, query.limit) };
};

const exportRefunds = async (query: IAdminRefundsQuery) => {
  const { rows } = await buildRefunds(query);
  assertUnderCap(rows.length);
  return rows;
};

// ---------------------------------------------------------------- Operator payouts (AC-5 to AC-7, AC-11)

/** Every counted booking in the trip date range, with its split (AC-5, AC-6). */
const loadPayoutBookings = async (query: { from?: string; to?: string; operatorId?: string }) => {
  const now = new Date();
  const window = utcWindow(query);
  const payments = await prisma.payment.findMany({
    where: {
      provider: 'STRIPE',
      paidAt: { not: null },
      booking: {
        status: { notIn: ['CANCELLED', 'EXPIRED'] },
        schedule: {
          status: { not: 'CANCELLED' },
          departureTime: { lte: now, ...window },
          ...(query.operatorId ? { ferry: { operatorId: query.operatorId } } : {}),
        },
      },
    },
    include: { refunds: { select: { status: true, amountCents: true } }, booking: bookingContext },
  });
  return payments
    .filter(p => isPayoutCounted(p, p.booking, p.booking.schedule, now))
    .filter(p => inDayRange(p.booking.schedule.departureTime, query))
    .map(p => {
      const split = splitNet(p.amountCents, p.operatorPayoutCents, countedRefundCents(p.refunds));
      const operator = p.booking.schedule.ferry.operator;
      return {
        id: p.booking.id,
        operatorId: operator.id,
        operatorName: operator.companyName,
        split,
        row: {
          bookingId: p.booking.id,
          bookingReference: p.booking.reference,
          route: routeOf(p.booking),
          tripDepartureTime: p.booking.schedule.departureTime,
          leadPassengerName: p.booking.leadPassengerName,
          paymentStatus: p.status,
          stripePaymentIntentId: p.stripePaymentIntentId,
          grossCents: split.gross,
          refundedCents: split.refunded,
          commissionNetCents: split.commissionNet,
          operatorNetCents: split.operatorNet,
        },
      };
    });
};

const listPayouts = async (query: IAdminPayoutsQuery) => {
  const bookings = await loadPayoutBookings(query);
  const byOperator = new Map<string, { name: string; splits: MoneySplit[] }>();
  for (const booking of bookings) {
    const entry = byOperator.get(booking.operatorId) ?? { name: booking.operatorName, splits: [] };
    entry.splits.push(booking.split);
    byOperator.set(booking.operatorId, entry);
  }
  const rows = [...byOperator.entries()].map(([operatorId, entry]) => {
    const totals = totalsOf(entry.splits);
    return { id: operatorId, operatorId, operatorName: entry.name, ...totals };
  });
  const sorted = sortRows(
    rows,
    query.sortBy === 'operatorName' ? row => row.operatorName.toLowerCase() : row => row.operatorNetCents,
    query.sortOrder ?? (query.sortBy === 'operatorName' ? 'asc' : 'desc'),
  ).map(({ id: _id, ...row }) => row);
  return {
    totals: totalsOf(bookings.map(b => b.split)),
    meta: { from: query.from ?? null, to: query.to ?? null, stripeMode: stripeMode() },
    data: sorted,
  };
};

const buildPayoutBookings = async (operatorId: string, query: IAdminPayoutBookingsQuery) => {
  const operator = await prisma.operatorProfile.findUnique({
    where: { id: operatorId },
    select: { id: true, companyName: true },
  });
  if (!operator) throw new ApiError(StatusCodes.NOT_FOUND, 'Operator not found');

  const bookings = await loadPayoutBookings({ ...query, operatorId });
  const rows = [...bookings]
    .sort(
      (a, b) =>
        a.row.tripDepartureTime.getTime() - b.row.tripDepartureTime.getTime() ||
        compare(a.row.bookingReference, b.row.bookingReference),
    )
    .map(b => b.row);
  return { operator, totals: totalsOf(bookings.map(b => b.split)), rows };
};

const listPayoutBookings = async (operatorId: string, query: IAdminPayoutBookingsQuery) => {
  const { operator, totals, rows } = await buildPayoutBookings(operatorId, query);
  const page = query.page ?? 1;
  const limit = query.limit ?? DEFAULT_LIMIT;
  return {
    operator,
    totals,
    meta: {
      page,
      limit,
      total: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / limit)),
      stripeMode: stripeMode(),
    },
    data: rows.slice((page - 1) * limit, page * limit),
  };
};

const exportPayoutBookings = async (operatorId: string, query: IAdminPayoutBookingsQuery) => {
  const result = await buildPayoutBookings(operatorId, query);
  assertUnderCap(result.rows.length);
  return result;
};

export const AdminPaymentsService = {
  listPayments,
  exportPayments,
  listRefunds,
  exportRefunds,
  listPayouts,
  listPayoutBookings,
  exportPayoutBookings,
};
