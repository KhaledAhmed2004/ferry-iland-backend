import {
  BookingStatus,
  BoardingStatus,
  TripStatus,
  VesselStatus,
  AccountStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { localDate, portToday } from '../../../shared/portTime';
import { PrismaAnalyticsBuilder } from '../../builder';
import {
  IAdminAnalyticsOverview,
  IDashboardDashboardStats,
  IDashboardStatMetric,
  IMonthlyTrends,
  IMonthlyTrendsFilters,
  IOperatorOverview,
  IOperatorRecentBookingItem,
  IOperatorStatMetric,
  IRecentActivity,
} from './dashboard.interface';

/** Spec 0001: only CONFIRMED and CHECKED_IN bookings count as sold. */
const SOLD_BOOKING_STATUS_FILTER = {
  in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN],
};

/** Unpaid holds and expired holds never appear in booking counts. */
const COUNTED_BOOKING_STATUS_FILTER = {
  notIn: [BookingStatus.PENDING, BookingStatus.EXPIRED],
};

/** Revenue counts only money actually collected (spec 0001, AC-6). */
const COLLECTED_PAYMENT_WHERE: Prisma.PaymentWhereInput = {
  OR: [
    { status: PaymentStatus.COMPLETED },
    { provider: PaymentProvider.LEGACY_SEED },
  ],
};

type CollectablePayment = {
  status: PaymentStatus;
  provider: PaymentProvider;
  amountCents: number;
  platformCommissionCents: number;
  operatorPayoutCents: number;
} | null;

const isCollectedPayment = (
  payment: CollectablePayment | undefined,
): payment is NonNullable<CollectablePayment> =>
  !!payment &&
  (payment.status === PaymentStatus.COMPLETED ||
    payment.provider === PaymentProvider.LEGACY_SEED);

const paymentMoneySelect = {
  status: true,
  provider: true,
  amountCents: true,
  platformCommissionCents: true,
  operatorPayoutCents: true,
} as const;

const centsToDollars = (cents: number | null | undefined) =>
  Number(((cents ?? 0) / 100).toFixed(2));

const getDashboardDashboardStats = async (): Promise<IDashboardDashboardStats> => {
  const userAnalytics = new PrismaAnalyticsBuilder(prisma.user, 'User');

  const [userGrowth, operatorGrowth] = await Promise.all([
    userAnalytics.calculateGrowth({ period: 'month' }),
    userAnalytics.calculateGrowth({
      period: 'month',
      where: { role: 'OPERATOR' },
    }),
  ]);

  const mapToMetric = (stat: {
    total: number;
    growth: number;
    growthType: any;
  }): IDashboardStatMetric => ({
    count: stat.total,
    growth: stat.growth,
    growthType: stat.growthType,
  });

  return {
    period: { type: 'monthly', comparison: 'previous_period' },
    users: mapToMetric(userGrowth),
    activeSubscriptions: { count: 0, growth: 0, growthType: 'no_change' },
    activeCampaigns: { count: 0, growth: 0, growthType: 'no_change' },
    activePosts: { count: 0, growth: 0, growthType: 'no_change' },
    totalLeads: mapToMetric(operatorGrowth),
  };
};

const getMonthlyTrends = async (
  _filters?: IMonthlyTrendsFilters | number,
): Promise<IMonthlyTrends> => {
  const userTrends = await new PrismaAnalyticsBuilder(
    prisma.user,
    'User',
  ).getTimeTrends({
    timeUnit: 'month',
    limit: 6,
  });

  return {
    campaignTrends: userTrends,
    postTrends: [],
  };
};

const getRecentActivities = async (limit: number = 5): Promise<IRecentActivity[]> => {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const recentUsers = await prisma.user.findMany({
    take: safeLimit,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  const activities: IRecentActivity[] = recentUsers.map(u => ({
    id: u.id,
    type: 'USER_REGISTERED',
    title: 'New user registered',
    description: `${u.name || 'A new user'} joined as ${u.role}`,
    timestamp: new Date(u.createdAt),
    link: `/admin/users/${u.id}`,
  }));

  return activities;
};

const getTopPerformers = async (limit: number = 5, _role?: string) => {
  const safeLimit = Math.max(1, Math.min(limit, 50));

  const [topOperators, topUsers] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'OPERATOR' },
      take: safeLimit,
      select: {
        id: true,
        name: true,
        email: true,
        operatorProfile: {
          select: {
            companyName: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { role: 'USER' },
      take: safeLimit,
      select: {
        id: true,
        name: true,
        email: true,
      },
    }),
  ]);

  return {
    topBusinesses: topOperators.map(o => ({
      id: o.id,
      name: o.name,
      email: o.email,
      companyName: o.operatorProfile?.companyName,
    })),
    topPromoters: topUsers,
  };
};

const computeGrowthMetric = (
  todayVal: number,
  yesterdayVal: number,
  comparedPeriod = 'yesterday',
): IOperatorStatMetric => {
  let changePercent = 0;
  if (yesterdayVal === 0) {
    changePercent = todayVal > 0 ? 100 : 0;
  } else {
    changePercent = Number(
      (((todayVal - yesterdayVal) / yesterdayVal) * 100).toFixed(1),
    );
  }

  let trend: 'up' | 'down' | 'neutral' = 'neutral';
  if (changePercent > 0) trend = 'up';
  else if (changePercent < 0) trend = 'down';

  return {
    value: todayVal,
    changePercent,
    trend,
    comparedPeriod,
  };
};

const getOperatorOverview = async (userId: string): Promise<IOperatorOverview> => {
  const operator = await prisma.operatorProfile.findUnique({
    where: { userId },
  });

  if (!operator) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Operator company profile not found for authenticated user',
    );
  }

  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
  const endOfToday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setUTCDate(startOfYesterday.getUTCDate() - 1);

  const endOfYesterday = new Date(endOfToday);
  endOfYesterday.setUTCDate(endOfYesterday.getUTCDate() - 1);

  const [
    ferries,
    allSchedules,
    allBookings,
    upcomingSchedules,
    recentBookings,
  ] = await Promise.all([
    prisma.ferry.findMany({
      where: { operatorId: operator.id },
      select: { id: true, status: true },
    }),
    prisma.schedule.findMany({
      where: {
        ferry: { operatorId: operator.id },
        departureTime: { gte: startOfYesterday, lte: endOfToday },
      },
      include: {
        route: {
          include: {
            departurePort: true,
            destinationPort: true,
          },
        },
        ferry: true,
        bookings: {
          where: { status: SOLD_BOOKING_STATUS_FILTER },
          select: {
            tickets: { select: { id: true } },
          },
        },
      },
      orderBy: { departureTime: 'asc' },
    }),
    prisma.booking.findMany({
      where: {
        schedule: { ferry: { operatorId: operator.id } },
        createdAt: { gte: startOfYesterday, lte: endOfToday },
        status: SOLD_BOOKING_STATUS_FILTER,
      },
      select: {
        totalAmount: true,
        createdAt: true,
        payment: { select: paymentMoneySelect },
      },
    }),
    prisma.schedule.findMany({
      where: {
        ferry: { operatorId: operator.id },
        departureTime: { gt: now },
        status: { not: TripStatus.CANCELLED },
      },
      include: {
        route: {
          include: {
            departurePort: true,
            destinationPort: true,
          },
        },
        ferry: true,
      },
      take: 5,
      orderBy: { departureTime: 'asc' },
    }),
    prisma.booking.findMany({
      where: {
        schedule: {
          ferry: { operatorId: operator.id },
        },
        status: COUNTED_BOOKING_STATUS_FILTER,
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        tickets: true,
        schedule: {
          include: {
            route: {
              include: {
                departurePort: true,
                destinationPort: true,
              },
            },
            ferry: true,
          },
        },
      },
    }),
  ]);

  const todaySchedules = allSchedules.filter(
    s => s.departureTime && new Date(s.departureTime) >= startOfToday,
  );
  const yesterdaySchedules = allSchedules.filter(
    s =>
      s.departureTime &&
      new Date(s.departureTime) >= startOfYesterday &&
      new Date(s.departureTime) < startOfToday,
  );

  const todayBookings = allBookings.filter(
    b => !b.createdAt || new Date(b.createdAt) >= startOfToday,
  );
  const yesterdayBookings = allBookings.filter(
    b =>
      b.createdAt &&
      new Date(b.createdAt) >= startOfYesterday &&
      new Date(b.createdAt) < startOfToday,
  );

  const inServiceVessels = ferries.filter(
    f => f.status === VesselStatus.IN_SERVICE,
  ).length;
  const totalVessels = ferries.length;

  const todayPassengers = todaySchedules.reduce((acc, schedule) => {
    const tripPax = schedule.bookings
      ? schedule.bookings.reduce(
          (paxAcc: number, b: any) => paxAcc + (b.tickets?.length || 0),
          0,
        )
      : 0;
    return acc + tripPax;
  }, 0);

  const yesterdayPassengers = yesterdaySchedules.reduce((acc, schedule) => {
    const tripPax = schedule.bookings
      ? schedule.bookings.reduce(
          (paxAcc: number, b: any) => paxAcc + (b.tickets?.length || 0),
          0,
        )
      : 0;
    return acc + tripPax;
  }, 0);

  // Operator net revenue = stored operator payout on collected payments (spec 0001, AC-3).
  const sumOperatorPayout = (bookings: typeof todayBookings) =>
    centsToDollars(
      bookings.reduce(
        (acc, b) =>
          acc + (isCollectedPayment(b.payment) ? b.payment.operatorPayoutCents : 0),
        0,
      ),
    );

  const netRevenue = sumOperatorPayout(todayBookings);
  const yesterdayNetRevenue = sumOperatorPayout(yesterdayBookings);

  const mapScheduleToQueueItem = (s: any) => ({
    id: s.id,
    departureTime: s.departureTime,
    arrivalTime: s.arrivalTime,
    gate: s.gate,
    captain: s.captain,
    status: s.status,
    route: {
      id: s.route.id,
      departurePort: {
        name: s.route.departurePort.name,
        code: s.route.departurePort.code,
        timeZone: s.route.departurePort.timeZone,
      },
      destinationPort: {
        name: s.route.destinationPort.name,
        code: s.route.destinationPort.code,
        timeZone: s.route.destinationPort.timeZone,
      },
    },
    ferry: {
      id: s.ferry.id,
      name: s.ferry.name,
      capacity: s.ferry.capacity,
    },
    capacity: s.ferry.capacity,
    bookedSeats: Math.max(0, s.ferry.capacity - s.availableSeats),
    availableSeats: s.availableSeats,
  });

  const mapBookingToRecentItem = (b: any): IOperatorRecentBookingItem => ({
    id: b.id || '',
    reference: b.reference || '',
    bookingReference: b.reference || '',
    passenger: b.leadPassengerName || 'Passenger',
    leadPassengerName: b.leadPassengerName || 'Passenger',
    email: b.leadPassengerEmail || '',
    leadPassengerEmail: b.leadPassengerEmail || '',
    route: b.schedule?.route
      ? `${b.schedule.route.departurePort?.name || ''} → ${b.schedule.route.destinationPort?.name || ''}`
      : 'Route',
    departureTime: b.schedule?.departureTime || b.createdAt || new Date(),
    // Departure port zone for dock local display (spec 0003); null when the booking has no trip.
    departureTimeZone: b.schedule?.route?.departurePort?.timeZone ?? null,
    pax:
      Array.isArray(b.tickets) && b.tickets.length > 0
        ? b.tickets.length
        : b.adultsCount
          ? b.adultsCount + (b.childrenCount || 0)
          : 1,
    amount: b.totalAmount ?? 0,
    totalAmount: b.totalAmount ?? 0,
    status: b.status || BookingStatus.CONFIRMED,
    vesselName: b.schedule?.ferry?.name || '',
    schedule: b.schedule
      ? {
          id: b.schedule.id,
          departureTime: b.schedule.departureTime,
          arrivalTime: b.schedule.arrivalTime,
          route: b.schedule.route,
          ferry: b.schedule.ferry,
        }
      : undefined,
    tickets: b.tickets || [],
  });

  return {
    kpis: {
      todayPassengers: computeGrowthMetric(
        todayPassengers,
        yesterdayPassengers,
        'yesterday',
      ),
      activeFleet: {
        inService: inServiceVessels,
        total: totalVessels,
        ratio: `${inServiceVessels}/${totalVessels}`,
      },
      todayBookings: computeGrowthMetric(
        todayBookings.length,
        yesterdayBookings.length,
        'yesterday',
      ),
      netRevenue: computeGrowthMetric(
        Number(netRevenue.toFixed(2)),
        Number(yesterdayNetRevenue.toFixed(2)),
        'yesterday',
      ),
    },
    todayDepartures: (await findTodayDeparturesAtPorts(operator.id, now)).map(mapScheduleToQueueItem),
    upcomingTrips: upcomingSchedules.map(mapScheduleToQueueItem),
    recentBookings: recentBookings.slice(0, 5).map(mapBookingToRecentItem),
  };
};

/**
 * Today's departures by each departure port's own today, not the UTC day (spec 0003, rule 16).
 * A UTC window padded by 14 hours covers every zone; each trip then keeps only if its local
 * date at its departure port is that port's today. The other overview counters stay on UTC.
 */
const findTodayDeparturesAtPorts = async (operatorId: string, now: Date) => {
  const padMs = 14 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  const candidates = await prisma.schedule.findMany({
    where: {
      ferry: { operatorId },
      departureTime: { gte: new Date(now.getTime() - dayMs - padMs), lte: new Date(now.getTime() + dayMs + padMs) },
    },
    include: {
      route: { include: { departurePort: true, destinationPort: true } },
      ferry: true,
      bookings: {
        where: { status: SOLD_BOOKING_STATUS_FILTER },
        select: { tickets: { select: { id: true } } },
      },
    },
    orderBy: { departureTime: 'asc' },
  });

  return candidates
    .filter(s => {
      const zone = s.route.departurePort.timeZone;
      return localDate(s.departureTime, zone) === portToday(zone, now);
    })
    .slice(0, 5);
};

/**
 * Percent change against the previous period. Returns null when the previous period had
 * nothing to compare with: a made up "+100%" would tell the admin the figure doubled.
 */
const calculateGrowthRate = (current: number, previous: number): number | null => {
  if (previous === 0) {
    return null;
  }
  const rate = ((current - previous) / previous) * 100;
  return Number(rate.toFixed(1));
};

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];
const DAY_MS = 24 * 60 * 60 * 1000;

const resolvePeriodRange = (periodParam: string | number = 30) => {
  const now = new Date();
  const str = String(periodParam).trim().toLowerCase();

  // Month to date: the 1st of this month through today, compared with the same number of
  // days at the start of last month (clamped to last month's end, e.g. Mar 31 vs Feb 28).
  if (str === 'this-month' || str === 'this_month' || str === 'mtd') {
    const curYear = now.getUTCFullYear();
    const curMonth = now.getUTCMonth();

    const currentStart = new Date(Date.UTC(curYear, curMonth, 1, 0, 0, 0, 0));
    const currentEnd = new Date(
      Date.UTC(curYear, curMonth, now.getUTCDate(), 23, 59, 59, 999),
    );
    const daysElapsed = now.getUTCDate();

    // prevEnd is exclusive (queried with `lt`); never past the start of this month.
    const prevStart = new Date(Date.UTC(curYear, curMonth - 1, 1, 0, 0, 0, 0));
    const prevEnd = new Date(
      Math.min(prevStart.getTime() + daysElapsed * DAY_MS, currentStart.getTime()),
    );

    // Up to a week in: one bar per day. After that: one bar per (roughly) week so far.
    const isDaily = daysElapsed <= 7;

    return {
      key: 'this-month',
      label: `This Month (${MONTH_NAMES[curMonth]} ${curYear})`,
      currentStart,
      currentEnd,
      prevStart,
      prevEnd,
      bucketType: (isDaily ? 'daily' : 'weekly') as 'daily' | 'weekly',
      bucketCount: isDaily ? daysElapsed : Math.ceil(daysElapsed / 7),
      days: daysElapsed,
    };
  }

  // Kept for API callers that still send it; the dashboard now offers "This Month" instead.
  if (str === 'month' || str === 'last-month' || str === 'last_month') {
    const curYear = now.getUTCFullYear();
    const curMonth = now.getUTCMonth(); // 0-11

    const currentStart = new Date(Date.UTC(curYear, curMonth - 1, 1, 0, 0, 0, 0));
    const currentEnd = new Date(Date.UTC(curYear, curMonth, 0, 23, 59, 59, 999));

    const prevStart = new Date(Date.UTC(curYear, curMonth - 2, 1, 0, 0, 0, 0));
    const prevEnd = new Date(Date.UTC(curYear, curMonth - 1, 0, 23, 59, 59, 999));

    const prevMonthIndex = currentStart.getUTCMonth();
    const prevMonthYear = currentStart.getUTCFullYear();
    const label = `Last Month (${MONTH_NAMES[prevMonthIndex]} ${prevMonthYear})`;

    return {
      key: 'month',
      label,
      currentStart,
      currentEnd,
      prevStart,
      prevEnd,
      bucketType: 'weekly' as const,
      bucketCount: 4,
      days: 30,
    };
  }

  let days = 30;
  let key = '30d';
  let label = 'Last 30 Days';

  if (str === '7d' || str === '7') {
    days = 7;
    key = '7d';
    label = 'Last 7 Days';
  } else if (str === '15d' || str === '15') {
    days = 15;
    key = '15d';
    label = 'Last 15 Days';
  } else {
    const parsed = parseInt(str, 10);
    if (!isNaN(parsed) && parsed > 0) {
      days = parsed;
      key = `${parsed}d`;
      label = `Last ${parsed} Days`;
    }
  }

  const currentEnd = now;
  const currentStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const prevEnd = currentStart;
  const prevStart = new Date(currentStart.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    key,
    label,
    currentStart,
    currentEnd,
    prevStart,
    prevEnd,
    bucketType: (days <= 7 ? 'daily' : 'weekly') as 'daily' | 'weekly',
    bucketCount: days <= 7 ? 7 : days <= 15 ? 5 : 4,
    days,
  };
};

const generateChartBuckets = (
  periodRange: ReturnType<typeof resolvePeriodRange>,
  periodBookings: Array<{
    payment: CollectablePayment;
    createdAt: Date;
    tickets: Array<{ id: string }>;
    adultsCount?: number | null;
    childrenCount?: number | null;
  }>,
) => {
  const { currentStart, currentEnd, bucketCount, key } = periodRange;
  const startMs = currentStart.getTime();
  const endMs = currentEnd.getTime();
  const totalDuration = endMs - startMs;
  const bucketDuration = totalDuration / bucketCount;

  const buckets = Array.from({ length: bucketCount }, (_, i) => {
    let label = `W${i + 1}`;
    if (key === 'this-month' && periodRange.bucketType === 'daily') {
      // Whole days from the 1st: the inclusive 23:59:59.999 end makes each bucket a hair
      // shorter than a day, so `i * bucketDuration` would land just before midnight.
      const bucketDate = new Date(startMs + i * DAY_MS);
      label = `${MONTH_NAMES[bucketDate.getUTCMonth()]} ${bucketDate.getUTCDate()}`;
    } else if (key === '7d') {
      const bucketDate = new Date(startMs + i * bucketDuration);
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      label = dayNames[bucketDate.getUTCDay()] || `Day ${i + 1}`;
    } else if (key === '15d') {
      label = `P${i + 1}`;
    }

    return {
      label,
      start: startMs + i * bucketDuration,
      end: startMs + (i + 1) * bucketDuration,
      revenueCents: 0,
      commissionCents: 0,
      payoutCents: 0,
      bookingsCount: 0,
      passengersCount: 0,
    };
  });

  for (const b of periodBookings) {
    const bTime = new Date(b.createdAt).getTime();
    const bucketIndex = Math.min(
      Math.max(0, Math.floor((bTime - startMs) / bucketDuration)),
      bucketCount - 1,
    );
    const bucket = buckets[bucketIndex];
    if (bucket) {
      if (isCollectedPayment(b.payment)) {
        bucket.revenueCents += b.payment.amountCents;
        bucket.commissionCents += b.payment.platformCommissionCents;
        bucket.payoutCents += b.payment.operatorPayoutCents;
      }
      bucket.bookingsCount += 1;
      const pax =
        b.tickets && b.tickets.length > 0
          ? b.tickets.length
          : (b.adultsCount || 1) + (b.childrenCount || 0);
      bucket.passengersCount += pax;
    }
  }

  return {
    revenue: buckets.map((b) => ({
      label: b.label,
      revenue: centsToDollars(b.revenueCents),
      commission: centsToDollars(b.commissionCents),
      payout: centsToDollars(b.payoutCents),
    })),
    bookings: buckets.map((b) => ({
      label: b.label,
      bookings: b.bookingsCount,
      passengers: b.passengersCount,
    })),
  };
};

const getAdminAnalyticsOverview = async (
  periodParam: string | number = 30,
): Promise<IAdminAnalyticsOverview> => {
  const period = resolvePeriodRange(periodParam);
  const { currentStart, currentEnd, prevStart, prevEnd } = period;

  const [
    totalProviders,
    activeProviders,
    suspendedProviders,
    totalFerries,
    inServiceFerries,
    maintenanceFerries,
    // Period-filtered Bookings
    periodTotalBookings,
    periodConfirmedBookings,
    periodCheckedInBookings,
    periodCancelledBookings,
    // Period-filtered Tickets
    periodTotalPax,
    periodBoardedPax,
    // Period-filtered Revenue
    periodFinancialAgg,
    // Previous Period for Growth
    prevBookingsCount,
    prevPaxCount,
    prevFinancialAgg,
    // Recent Lists
    recentProviders,
    recentBookings,
    // Period Bookings for Chart Data
    periodBookingsForChart,
    // All-time Totals
    allTimeBookingsCount,
    allTimePaxCount,
    allTimeFinancialAgg,
  ] = await Promise.all([
    prisma.operatorProfile.count(),
    prisma.user.count({
      where: { role: 'OPERATOR', status: AccountStatus.ACTIVE },
    }),
    prisma.user.count({
      where: { role: 'OPERATOR', status: AccountStatus.SUSPENDED },
    }),
    prisma.ferry.count(),
    prisma.ferry.count({ where: { status: VesselStatus.IN_SERVICE } }),
    prisma.ferry.count({ where: { status: VesselStatus.MAINTENANCE } }),

    // Period Bookings
    prisma.booking.count({
      where: {
        status: COUNTED_BOOKING_STATUS_FILTER,
        createdAt: { gte: currentStart, lte: currentEnd },
      },
    }),
    prisma.booking.count({
      where: {
        status: BookingStatus.CONFIRMED,
        createdAt: { gte: currentStart, lte: currentEnd },
      },
    }),
    prisma.booking.count({
      where: {
        status: BookingStatus.CHECKED_IN,
        createdAt: { gte: currentStart, lte: currentEnd },
      },
    }),
    prisma.booking.count({
      where: {
        status: BookingStatus.CANCELLED,
        createdAt: { gte: currentStart, lte: currentEnd },
      },
    }),

    // Period Tickets: only passengers on sold bookings (cancelled ones are not travelling).
    prisma.ticket.count({
      where: {
        booking: { status: SOLD_BOOKING_STATUS_FILTER },
        createdAt: { gte: currentStart, lte: currentEnd },
      },
    }),
    prisma.ticket.count({
      where: {
        boardingStatus: BoardingStatus.BOARDED,
        booking: { status: COUNTED_BOOKING_STATUS_FILTER },
        createdAt: { gte: currentStart, lte: currentEnd },
      },
    }),

    // Period Revenue
    prisma.payment.aggregate({
      where: {
        ...COLLECTED_PAYMENT_WHERE,
        booking: {
          status: SOLD_BOOKING_STATUS_FILTER,
          createdAt: { gte: currentStart, lte: currentEnd },
        },
      },
      _sum: {
        amountCents: true,
        platformCommissionCents: true,
        operatorPayoutCents: true,
      },
    }),

    // Previous Period for Growth: same "sold" rule as the KPIs, so growth compares like with like.
    prisma.booking.count({
      where: {
        status: SOLD_BOOKING_STATUS_FILTER,
        createdAt: { gte: prevStart, lt: prevEnd },
      },
    }),
    prisma.ticket.count({
      where: {
        booking: { status: SOLD_BOOKING_STATUS_FILTER },
        createdAt: { gte: prevStart, lt: prevEnd },
      },
    }),
    prisma.payment.aggregate({
      where: {
        ...COLLECTED_PAYMENT_WHERE,
        booking: {
          status: SOLD_BOOKING_STATUS_FILTER,
          createdAt: { gte: prevStart, lt: prevEnd },
        },
      },
      _sum: { amountCents: true },
    }),

    // Recent Lists
    prisma.operatorProfile.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { status: true } },
        _count: { select: { ferries: true } },
      },
    }),
    prisma.booking.findMany({
      where: { status: COUNTED_BOOKING_STATUS_FILTER },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        schedule: {
          include: {
            route: {
              include: {
                departurePort: true,
                destinationPort: true,
              },
            },
            ferry: {
              include: {
                operator: {
                  select: {
                    companyName: true,
                  },
                },
              },
            },
          },
        },
      },
    }),

    // Chart Bookings
    prisma.booking.findMany({
      where: {
        createdAt: { gte: currentStart, lte: currentEnd },
        status: SOLD_BOOKING_STATUS_FILTER,
      },
      select: {
        payment: { select: paymentMoneySelect },
        createdAt: true,
        tickets: { select: { id: true } },
        adultsCount: true,
        childrenCount: true,
      },
    }),

    // All-time Totals
    prisma.booking.count({ where: { status: COUNTED_BOOKING_STATUS_FILTER } }),
    prisma.ticket.count({
      where: { booking: { status: COUNTED_BOOKING_STATUS_FILTER } },
    }),
    prisma.payment.aggregate({
      where: {
        ...COLLECTED_PAYMENT_WHERE,
        booking: { status: SOLD_BOOKING_STATUS_FILTER },
      },
      _sum: { amountCents: true },
    }),
  ]);

  // Spec 0001, AC-3: commission and payout are sums of the stored cents, never a hard coded rate.
  const grossSales = centsToDollars(periodFinancialAgg._sum.amountCents);
  const platformCommission = centsToDollars(
    periodFinancialAgg._sum.platformCommissionCents,
  );
  const providerPayout = centsToDollars(periodFinancialAgg._sum.operatorPayoutCents);

  const prevGross = centsToDollars(prevFinancialAgg._sum.amountCents);

  const revenueGrowth = calculateGrowthRate(grossSales, prevGross);
  // KPI bookings count what was actually sold, matching revenue. Cancelled ones stay visible
  // in breakdowns.bookings (total / cancelled), not in the headline number.
  const periodSoldBookings = periodConfirmedBookings + periodCheckedInBookings;
  const bookingsGrowth = calculateGrowthRate(periodSoldBookings, prevBookingsCount);
  const passengersGrowth = calculateGrowthRate(periodTotalPax, prevPaxCount);

  const chartData = generateChartBuckets(period, periodBookingsForChart || []);
  const allTimeGross = centsToDollars(allTimeFinancialAgg._sum.amountCents);

  const fleetServiceRate =
    totalFerries > 0 ? Number(((inServiceFerries / totalFerries) * 100).toFixed(1)) : 100;

  const resolveTrend = (percent: number | null): 'up' | 'down' | 'neutral' => {
    if (percent === null) return 'neutral';
    if (percent > 0) return 'up';
    if (percent < 0) return 'down';
    return 'neutral';
  };

  const formattedRecentProviders = recentProviders.map((p) => ({
    id: p.id,
    companyName: p.companyName,
    contactPersonName: p.contactPersonName,
    status: p.user.status,
    ferriesCount: p._count.ferries,
    createdAt: p.createdAt,
  }));

  const formattedRecentBookings = recentBookings.map((b) => {
    const adults = b.adultsCount || 1;
    const children = b.childrenCount || 0;
    return {
      id: b.id,
      reference: b.reference,
      leadPassengerName: b.leadPassengerName,
      leadPassengerEmail: b.leadPassengerEmail,
      totalAmount: b.totalAmount,
      status: b.status,
      createdAt: b.createdAt,
      departureTime: b.schedule.departureTime,
      route: `${b.schedule.route.departurePort.name} → ${b.schedule.route.destinationPort.name}`,
      vessel: b.schedule.ferry.name,
      operatorName: b.schedule.ferry.operator?.companyName || 'Operator',
      adultsCount: adults,
      childrenCount: children,
      paxCount: adults + children,
    };
  });

  return {
    period: {
      key: period.key,
      label: period.label,
      startDate: period.currentStart,
      endDate: period.currentEnd,
      days: period.days,
    },
    kpis: {
      netRevenue: {
        value: platformCommission,
        subValue: Number(grossSales.toFixed(2)),
        changePercent: revenueGrowth,
        trend: resolveTrend(revenueGrowth),
        currency: 'USD',
        label: 'Net Platform Revenue',
      },
      totalBookings: {
        value: periodSoldBookings,
        changePercent: bookingsGrowth,
        trend: resolveTrend(bookingsGrowth),
        label: 'Total Bookings',
      },
      totalPassengers: {
        value: periodTotalPax,
        changePercent: passengersGrowth,
        trend: resolveTrend(passengersGrowth),
        label: 'Total Passengers',
      },
      fleet: {
        total: totalFerries,
        inService: inServiceFerries,
        maintenance: maintenanceFerries,
        changePercent: fleetServiceRate,
        trend: 'neutral',
      },
    },
    breakdowns: {
      financials: {
        grossSales: Number(grossSales.toFixed(2)),
        platformCommission,
        providerPayout,
        changePercent: revenueGrowth,
      },
      bookings: {
        total: periodTotalBookings,
        confirmed: periodConfirmedBookings,
        checkedIn: periodCheckedInBookings,
        cancelled: periodCancelledBookings,
        changePercent: bookingsGrowth,
      },
      passengers: {
        totalPax: periodTotalPax,
        boardedPax: periodBoardedPax,
        changePercent: passengersGrowth,
      },
      fleet: {
        total: totalFerries,
        inService: inServiceFerries,
        maintenance: maintenanceFerries,
      },
      providers: {
        total: totalProviders,
        active: activeProviders,
        suspended: suspendedProviders,
      },
    },
    allTime: {
      grossSales: Number(allTimeGross.toFixed(2)),
      totalBookings: allTimeBookingsCount,
      totalPax: allTimePaxCount,
    },
    charts: {
      revenueTrend: chartData,
      allTimeTotals: {
        grossSales: Number(allTimeGross.toFixed(2)),
        totalBookings: allTimeBookingsCount,
        totalPax: allTimePaxCount,
      },
    },
    recent: {
      providers: formattedRecentProviders,
      bookings: formattedRecentBookings,
    },
  };
};

export const DashboardService = {
  getDashboardDashboardStats,
  getMonthlyTrends,
  getRecentActivities,
  getTopPerformers,
  getOperatorOverview,
  getAdminAnalyticsOverview,
};
