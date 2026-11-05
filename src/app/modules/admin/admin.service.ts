import { PaymentProvider, PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../../shared/prisma';
import { AdminPaymentSortField, IPlatformSettingsResponse } from './admin.interface';
import { UpdateCommissionDTO, UpdatePlatformDTO } from './admin.validation';

export interface IAdminPaymentsFilterOptions {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  searchTerm?: string;
  sortBy?: AdminPaymentSortField;
  sortOrder?: 'asc' | 'desc';
}

const buildPaymentOrderBy = (
  sortBy: AdminPaymentSortField = 'createdAt',
  sortOrder: 'asc' | 'desc' = 'desc',
): Prisma.PaymentOrderByWithRelationInput[] => {
  const primary: Record<AdminPaymentSortField, Prisma.PaymentOrderByWithRelationInput> = {
    createdAt: { createdAt: sortOrder },
    bookingAmount: { amountCents: sortOrder },
    commission: { platformCommissionCents: sortOrder },
    providerAmount: { operatorPayoutCents: sortOrder },
    paymentStatus: { status: sortOrder },
    bookingReference: { booking: { reference: sortOrder } },
  };
  // Tie-breakers keep page boundaries stable when sort values repeat.
  return [primary[sortBy], { createdAt: 'desc' }, { id: 'asc' }];
};

const centsToDollars = (cents: number | null | undefined) =>
  Number(((cents ?? 0) / 100).toFixed(2));

const getOrCreatePlatformSettings = async () => {
  const existing = await prisma.platformSetting.findFirst();
  if (existing) {
    return existing;
  }

  return prisma.platformSetting.create({
    data: {
      platformName: 'FerryGo',
      supportEmail: 'support@ferrygo.com',
      commissionRate: 10.0,
      payoutSchedule: 'WEEKLY',
    },
  });
};

const getPlatformSettings = async (): Promise<IPlatformSettingsResponse> => {
  const settings = await getOrCreatePlatformSettings();
  return {
    id: settings.id,
    platformName: settings.platformName,
    supportEmail: settings.supportEmail,
    commissionRate: settings.commissionRate,
    payoutSchedule: settings.payoutSchedule,
    seatHoldMinutes: settings.seatHoldMinutes,
    updatedAt: settings.updatedAt,
  };
};

const updateCommissionSettings = async (
  payload: UpdateCommissionDTO,
): Promise<IPlatformSettingsResponse> => {
  const current = await getOrCreatePlatformSettings();

  return prisma.platformSetting.update({
    where: { id: current.id },
    data: {
      commissionRate:
        payload.rate !== undefined ? payload.rate : current.commissionRate,
      payoutSchedule: payload.schedule || current.payoutSchedule,
      seatHoldMinutes:
        payload.seatHoldMinutes !== undefined
          ? payload.seatHoldMinutes
          : current.seatHoldMinutes,
    },
  });
};

const updatePlatformInfo = async (
  payload: UpdatePlatformDTO,
): Promise<IPlatformSettingsResponse> => {
  const current = await getOrCreatePlatformSettings();

  return prisma.platformSetting.update({
    where: { id: current.id },
    data: {
      platformName: payload.name || current.platformName,
      supportEmail: payload.email || current.supportEmail,
    },
  });
};

const getAdminPayments = async (options: IAdminPaymentsFilterOptions = {}) => {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 10));
  const skip = (page - 1) * limit;

  const searchTerm = (options.searchTerm || options.search || '').trim();
  const statusFilter =
    options.status && options.status !== 'ALL' && options.status !== 'all'
      ? options.status.toUpperCase()
      : undefined;

  const whereClause: Prisma.PaymentWhereInput = {
    ...(statusFilter ? { status: statusFilter as any } : {}),
    ...(searchTerm
      ? {
          OR: [
            { booking: { reference: { contains: searchTerm, mode: 'insensitive' } } },
            { booking: { leadPassengerName: { contains: searchTerm, mode: 'insensitive' } } },
            {
              booking: {
                schedule: {
                  route: {
                    operator: { companyName: { contains: searchTerm, mode: 'insensitive' } },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [payments, totalCount, collectedFinancialAgg, allActiveFinancialAgg, settings] =
    await Promise.all([
      prisma.payment.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: buildPaymentOrderBy(options.sortBy, options.sortOrder),
        include: {
          booking: {
            include: {
              schedule: {
                include: {
                  route: {
                    include: {
                      operator: true,
                      departurePort: true,
                      destinationPort: true,
                    },
                  },
                  ferry: true,
                },
              },
              tickets: true,
            },
          },
        },
      }),
      prisma.payment.count({ where: whereClause }),
      prisma.payment.aggregate({
        where: {
          OR: [
            { status: PaymentStatus.COMPLETED },
            { provider: PaymentProvider.LEGACY_SEED },
          ],
        },
        _sum: {
          amountCents: true,
          platformCommissionCents: true,
          operatorPayoutCents: true,
        },
      }),
      prisma.payment.aggregate({
        where: {
          status: { notIn: [PaymentStatus.CANCELED, PaymentStatus.FAILED] },
        },
        _sum: {
          amountCents: true,
          platformCommissionCents: true,
          operatorPayoutCents: true,
        },
      }),
      getOrCreatePlatformSettings(),
    ]);

  const effectiveAgg =
    (collectedFinancialAgg._sum.amountCents ?? 0) > 0
      ? collectedFinancialAgg
      : allActiveFinancialAgg;

  const totalBookingValue = centsToDollars(effectiveAgg._sum.amountCents);
  const platformCommission = centsToDollars(effectiveAgg._sum.platformCommissionCents);
  const providerAmount = centsToDollars(effectiveAgg._sum.operatorPayoutCents);

  const formattedPayments = payments.map(payment => {
    const booking = payment.booking;
    const bookingAmount = centsToDollars(payment.amountCents);
    const commission = centsToDollars(payment.platformCommissionCents);
    const providerPayout = centsToDollars(payment.operatorPayoutCents);
    const route = booking?.schedule?.route;
    const operator = route?.operator;

    return {
      id: payment.id,
      bookingId: payment.bookingId,
      bookingReference: booking?.reference || 'N/A',
      provider: operator?.companyName || 'Unknown Operator',
      bookingAmount,
      commission,
      providerAmount: providerPayout,
      paymentStatus: payment.status,
      passenger: booking?.leadPassengerName || 'Guest Passenger',
      route: route
        ? `${route.departurePort?.name || 'Origin'} → ${route.destinationPort?.name || 'Destination'}`
        : 'N/A',
      travelDate: booking?.schedule?.departureTime
        ? new Date(booking.schedule.departureTime).toISOString().split('T')[0]
        : new Date(payment.createdAt).toISOString().split('T')[0],
      pax:
        (booking?.adultsCount || 0) + (booking?.childrenCount || 0) ||
        (booking?.tickets?.length ?? 1),
      paymentMethod:
        payment.paymentMethod ||
        (payment.provider ? `${payment.provider}` : 'Online Card Payment'),
      paidAt: payment.paidAt
        ? new Date(payment.paidAt).toISOString()
        : new Date(payment.createdAt).toISOString(),
      createdAt: payment.createdAt.toISOString(),
    };
  });

  return {
    overview: {
      totalBookingValue,
      commission: platformCommission,
      providerAmount,
      commissionRate: settings.commissionRate,
    },
    meta: {
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1,
    },
    data: formattedPayments,
  };
};

export const AdminService = {
  getOrCreatePlatformSettings,
  getPlatformSettings,
  updateCommissionSettings,
  updatePlatformInfo,
  getAdminPayments,
};
