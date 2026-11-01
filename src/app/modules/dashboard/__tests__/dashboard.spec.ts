import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AccountStatus,
  BoardingStatus,
  BookingStatus,
  TripStatus,
  VesselStatus,
} from '@prisma/client';
import { DashboardService } from '../dashboard.service';
import { prisma } from '../../../../shared/prisma';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    operatorProfile: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    ferry: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    schedule: {
      findMany: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    payment: {
      aggregate: vi.fn(),
    },
    ticket: {
      count: vi.fn(),
    },
  },
}));

describe('DashboardService Ferry Analytics Unit Tests', () => {
  const mockOperator = {
    id: 'op-123',
    userId: 'user-op-123',
    companyName: 'Pacific Ferries',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOperatorOverview', () => {
    it('computes real-time fleet KPIs and today departures queue', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );

      vi.mocked(prisma.ferry.findMany).mockResolvedValue([
        { id: 'f-1', status: VesselStatus.IN_SERVICE },
        { id: 'f-2', status: VesselStatus.IN_SERVICE },
        { id: 'f-3', status: VesselStatus.MAINTENANCE },
      ] as any);

      vi.mocked(prisma.schedule.findMany)
        .mockResolvedValueOnce([
          {
            id: 'sched-1',
            departureTime: new Date(),
            arrivalTime: new Date(),
            gate: 'Gate 2',
            captain: 'Capt. Nemo',
            status: TripStatus.BOARDING,
            availableSeats: 30,
            route: {
              id: 'route-1',
              departurePort: { name: 'Port A', code: 'PTA' },
              destinationPort: { name: 'Port B', code: 'PTB' },
            },
            ferry: {
              id: 'f-1',
              name: 'Nautilus',
              registration: 'REG-101',
              capacity: 100,
            },
            bookings: [
              {
                tickets: [{ id: 't-1' }, { id: 't-2' }, { id: 't-3' }],
              },
            ],
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            id: 'sched-upcoming-1',
            departureTime: new Date(Date.now() + 3600000),
            arrivalTime: new Date(Date.now() + 7200000),
            gate: 'Gate 2',
            captain: 'Capt. Nemo',
            status: TripStatus.ON_TIME,
            availableSeats: 80,
            route: {
              id: 'route-1',
              departurePort: { name: 'Port A', code: 'PTA' },
              destinationPort: { name: 'Port B', code: 'PTB' },
            },
            ferry: {
              id: 'f-1',
              name: 'Nautilus',
              registration: 'REG-101',
              capacity: 100,
            },
          },
        ] as any);

      // Net revenue comes from stored operator payout cents on collected payments (spec 0001).
      const collected = (amountCents: number) => ({
        status: 'COMPLETED',
        provider: 'STRIPE',
        amountCents,
        platformCommissionCents: amountCents / 10,
        operatorPayoutCents: amountCents - amountCents / 10,
      });
      const soldBookings = [
        { totalAmount: 200, payment: collected(20000) },
        { totalAmount: 300, payment: collected(30000) },
        // An unpaid MANUAL booking counts as a booking but is not revenue.
        {
          totalAmount: 999,
          payment: {
            status: 'PENDING',
            provider: 'MANUAL',
            amountCents: 99900,
            platformCommissionCents: 9990,
            operatorPayoutCents: 89910,
          },
        },
      ];
      vi.mocked(prisma.booking.findMany)
        .mockResolvedValueOnce(soldBookings as any) // today and yesterday bookings
        .mockResolvedValueOnce(soldBookings.slice(0, 2) as any); // recent bookings

      const overview = await DashboardService.getOperatorOverview('user-op-123');

      expect(overview.kpis.todayPassengers.value).toBe(3);
      expect(overview.kpis.todayPassengers.comparedPeriod).toBe('yesterday');
      expect(overview.kpis.activeFleet).toEqual({
        inService: 2,
        total: 3,
        ratio: '2/3',
      });
      expect(overview.kpis.todayBookings.value).toBe(3);
      expect(overview.kpis.todayBookings.comparedPeriod).toBe('yesterday');
      expect(overview.kpis.netRevenue.value).toBe(450);
      expect(overview.kpis.netRevenue.comparedPeriod).toBe('yesterday');
      expect(overview.todayDepartures).toHaveLength(1);
      expect(overview.todayDepartures[0].bookedSeats).toBe(70);
      expect(overview.todayDepartures[0].availableSeats).toBe(30);
      expect(overview.upcomingTrips).toHaveLength(1);
      expect(overview.recentBookings).toHaveLength(2);
    });

    it('throws 404 when operator profile is missing', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(null);

      await expect(
        DashboardService.getOperatorOverview('unknown-user'),
      ).rejects.toThrowError(
        'Operator company profile not found for authenticated user',
      );
    });
  });

    describe('getAdminAnalyticsOverview', () => {
    it('aggregates platform KPIs, gross sales, commission, and recent activity for the selected period', async () => {
      vi.mocked(prisma.operatorProfile.count).mockResolvedValue(5);
      vi.mocked(prisma.user.count)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(1);

      vi.mocked(prisma.ferry.count)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(2);

      vi.mocked(prisma.booking.count)
        .mockResolvedValueOnce(100) // period total
        .mockResolvedValueOnce(80)  // period confirmed
        .mockResolvedValueOnce(15)  // period checkedIn
        .mockResolvedValueOnce(5)   // period cancelled
        .mockResolvedValueOnce(50)  // prev bookings count (growth: (100 - 50) / 50 = 100%)
        .mockResolvedValueOnce(500); // all-time bookings

      vi.mocked(prisma.ticket.count)
        .mockResolvedValueOnce(250) // period total pax
        .mockResolvedValueOnce(180) // period boarded pax
        .mockResolvedValueOnce(200) // prev pax count (growth: (250 - 200) / 200 = 25%)
        .mockResolvedValueOnce(1000); // all-time pax

      // Stored cents, with a 12% commission so a hard coded 10% would fail this test.
      vi.mocked(prisma.payment.aggregate)
        .mockResolvedValueOnce({
          _sum: {
            amountCents: 1000000,
            platformCommissionCents: 120000,
            operatorPayoutCents: 880000,
          },
        } as any)
        .mockResolvedValueOnce({
          _sum: { amountCents: 500000 }, // prev gross (growth: (10000 - 5000) / 5000 = 100%)
        } as any)
        .mockResolvedValueOnce({
          _sum: { amountCents: 5000000 }, // all-time gross
        } as any);

      vi.mocked(prisma.operatorProfile.findMany).mockResolvedValue([
        {
          id: 'op-1',
          companyName: 'Blue Ocean Lines',
          contactPersonName: 'Sarah Connor',
          createdAt: new Date('2026-01-01'),
          user: { status: AccountStatus.ACTIVE },
          _count: { ferries: 3 },
        },
      ] as any);

      vi.mocked(prisma.booking.findMany)
        .mockResolvedValueOnce([
          {
            id: 'book-1',
            reference: 'FRY-20261015-ABCD',
            leadPassengerName: 'John Doe',
            totalAmount: 150,
            status: BookingStatus.CONFIRMED,
            createdAt: new Date('2026-10-15T10:00:00Z'),
            schedule: {
              departureTime: new Date('2026-10-16T08:00:00Z'),
              ferry: { name: 'Seaspray', operator: { companyName: 'Royal Ferries' } },
              route: {
                departurePort: { name: 'Port Royal' },
                destinationPort: { name: 'Tortuga' },
              },
            },
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            payment: {
              status: 'COMPLETED',
              provider: 'STRIPE',
              amountCents: 15000,
              platformCommissionCents: 1800,
              operatorPayoutCents: 13200,
            },
            createdAt: new Date('2026-10-15T10:00:00Z'),
            tickets: [{ id: 't-1' }],
            adultsCount: 1,
            childrenCount: 0,
          },
        ] as any);

      const analytics = await DashboardService.getAdminAnalyticsOverview(30);

      expect(analytics.breakdowns.providers).toEqual({
        total: 5,
        active: 4,
        suspended: 1,
      });
      expect(analytics.breakdowns.fleet).toEqual({
        total: 12,
        inService: 10,
        maintenance: 2,
      });
      expect(analytics.breakdowns.bookings).toEqual({
        total: 100,
        confirmed: 80,
        checkedIn: 15,
        cancelled: 5,
        changePercent: 100,
      });
      expect(analytics.breakdowns.passengers).toEqual({
        totalPax: 250,
        boardedPax: 180,
        changePercent: 25,
      });
      expect(analytics.breakdowns.financials).toEqual({
        grossSales: 10000,
        platformCommission: 1200,
        providerPayout: 8800,
        changePercent: 100,
      });
      expect(analytics.kpis.netRevenue.changePercent).toBe(100);
      expect(analytics.kpis.totalBookings.changePercent).toBe(100);
      expect(analytics.kpis.totalPassengers.changePercent).toBe(25);
      expect(analytics.recent.providers).toHaveLength(1);
      expect(analytics.recent.providers[0].companyName).toBe('Blue Ocean Lines');
      expect(analytics.recent.bookings).toHaveLength(1);
      expect(analytics.recent.bookings[0].reference).toBe('FRY-20261015-ABCD');
      expect(analytics.period.key).toBe('30d');
      expect(analytics.allTime.grossSales).toBe(50000);
      expect(analytics.charts.revenueTrend.revenue).toHaveLength(4);
      expect(analytics.charts.revenueTrend.bookings).toHaveLength(4);
    });

    it('resolves Last Month calendar range and period metadata correctly', async () => {
      vi.mocked(prisma.operatorProfile.count).mockResolvedValue(1);
      vi.mocked(prisma.user.count).mockResolvedValue(1);
      vi.mocked(prisma.ferry.count).mockResolvedValue(1);
      vi.mocked(prisma.booking.count).mockResolvedValue(0);
      vi.mocked(prisma.ticket.count).mockResolvedValue(0);
      vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amountCents: 0 } } as any);
      vi.mocked(prisma.operatorProfile.findMany).mockResolvedValue([]);
      vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

      const analytics = await DashboardService.getAdminAnalyticsOverview('month');
      expect(analytics.period.key).toBe('month');
      expect(analytics.period.label).toContain('Last Month');
      expect(analytics.charts.revenueTrend.revenue).toHaveLength(4);
      expect(analytics.charts.revenueTrend.bookings).toHaveLength(4);
    });
  });
});
