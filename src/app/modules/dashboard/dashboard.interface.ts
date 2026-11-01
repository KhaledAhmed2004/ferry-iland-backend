import {
  GrowthType,
  ITrendPoint,
} from '../../builder';

export interface IDashboardStatMetric {
  count: number;
  growth: number;
  growthType: GrowthType;
}

export type IDashboardDashboardStats = {
  period: {
    type: string;
    comparison: string;
  };
  users: IDashboardStatMetric;
  activeSubscriptions: IDashboardStatMetric;
  activeCampaigns: IDashboardStatMetric;
  activePosts: IDashboardStatMetric;
  totalLeads: IDashboardStatMetric;
};

export type IMonthlyTrends = {
  campaignTrends: ITrendPoint[];
  postTrends: ITrendPoint[];
};

export interface IMonthlyTrendsFilters {
  year?: number;
  range?: '3m' | '6m' | '12m' | 'this-year' | string;
  metric?: 'all' | 'campaigns' | 'posts' | string;
}

export type ActivityType =
  | 'USER_REGISTERED'
  | 'USER_PENDING'
  | 'CAMPAIGN_POSTED'
  | 'POST_LISTED'
  | 'SUBSCRIPTION_ACTIVATED'
  | 'GENERAL';

export interface IRecentActivity {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  timestamp: Date;
  link?: string;
  metadata?: Record<string, unknown>;
}

export interface IOperatorStatMetric {
  value: number;
  changePercent: number;
  trend: 'up' | 'down' | 'neutral';
  comparedPeriod: string;
}

export interface IOperatorOverviewKpis {
  todayPassengers: IOperatorStatMetric;
  activeFleet: {
    inService: number;
    total: number;
    ratio: string;
  };
  todayBookings: IOperatorStatMetric;
  netRevenue: IOperatorStatMetric;
}

export interface IOperatorDepartureQueueItem {
  id: string;
  departureTime: Date;
  arrivalTime: Date;
  gate: string | null;
  captain: string | null;
  status: string;
  route: {
    id: string;
    departurePort: {
      name: string;
      code: string | null;
    };
    destinationPort: {
      name: string;
      code: string | null;
    };
  };
  ferry: {
    id: string;
    name: string;
    registration: string;
    capacity: number;
  };
  capacity: number;
  bookedSeats: number;
  availableSeats: number;
}

export interface IOperatorRecentBookingItem {
  id: string;
  reference: string;
  bookingReference: string;
  passenger: string;
  leadPassengerName: string;
  email: string;
  leadPassengerEmail: string;
  route: string;
  departureTime: Date;
  pax: number;
  amount: number;
  totalAmount: number;
  status: string;
  vesselName: string;
  schedule?: {
    id: string;
    departureTime: Date;
    arrivalTime: Date;
    route?: {
      id: string;
      departurePort?: { name: string; code: string | null };
      destinationPort?: { name: string; code: string | null };
    };
    ferry?: {
      id: string;
      name: string;
    };
  };
  tickets?: Array<{ id: string }>;
}

export interface IOperatorOverview {
  kpis: IOperatorOverviewKpis;
  todayDepartures: IOperatorDepartureQueueItem[];
  upcomingTrips: IOperatorDepartureQueueItem[];
  recentBookings: IOperatorRecentBookingItem[];
}

export interface IAdminPeriodInfo {
  key: string;
  label: string;
  startDate: Date;
  endDate: Date;
  days?: number;
}

export interface IAdminChartDataPointRevenue {
  label: string;
  revenue: number;
  commission: number;
  payout: number;
}

export interface IAdminChartDataPointBookings {
  label: string;
  bookings: number;
  passengers: number;
}

export interface IAdminChartData {
  revenue: IAdminChartDataPointRevenue[];
  bookings: IAdminChartDataPointBookings[];
}

export interface IAdminAllTimeMetrics {
  grossSales: number;
  totalBookings: number;
  totalPax: number;
}

export interface IAdminKpiItem {
  value: number;
  changePercent: number;
  trend: 'up' | 'down' | 'neutral';
  currency?: string;
  subValue?: number;
  label?: string;
}

export interface IAdminKpis {
  netRevenue: IAdminKpiItem;
  totalBookings: IAdminKpiItem;
  totalPassengers: IAdminKpiItem;
  fleet: {
    total: number;
    inService: number;
    maintenance: number;
    changePercent: number;
    trend: 'up' | 'down' | 'neutral';
  };
}

export interface IAdminBreakdowns {
  financials: {
    grossSales: number;
    platformCommission: number;
    providerPayout: number;
    changePercent: number;
  };
  bookings: {
    total: number;
    confirmed: number;
    checkedIn: number;
    cancelled: number;
    changePercent: number;
  };
  passengers: {
    totalPax: number;
    boardedPax: number;
    changePercent: number;
  };
  fleet: {
    total: number;
    inService: number;
    maintenance: number;
  };
  providers: {
    total: number;
    active: number;
    suspended: number;
  };
}

export interface IAdminAnalyticsOverview {
  period: IAdminPeriodInfo;
  kpis: IAdminKpis;
  breakdowns: IAdminBreakdowns;
  allTime: IAdminAllTimeMetrics;
  charts: {
    revenueTrend: IAdminChartData;
    allTimeTotals?: IAdminAllTimeMetrics;
  };
  recent: {
    providers: Array<{
      id: string;
      companyName: string;
      contactPersonName: string;
      status: string;
      ferriesCount: number;
      createdAt: Date;
    }>;
    bookings: Array<{
      id: string;
      reference: string;
      leadPassengerName: string;
      leadPassengerEmail?: string;
      totalAmount: number;
      status: string;
      createdAt: Date;
      departureTime?: Date;
      route: string;
      vessel: string;
      operatorName?: string;
      adultsCount?: number;
      childrenCount?: number;
      paxCount?: number;
    }>;
  };
}
