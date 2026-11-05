import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
              capacity: 100,
            },
          },
        ] as any)
        // Today's departures at each port's own today (spec 0003, rule 16): the one leaving
        // now is kept, the one 30 hours away is another local day and is dropped.
        .mockImplementationOnce((async () => [
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
              departurePort: { name: 'Port A', code: 'PTA', timeZone: 'America/Anguilla' },
              destinationPort: { name: 'Port B', code: 'PTB', timeZone: 'America/Anguilla' },
            },
            ferry: { id: 'f-1', name: 'Nautilus', capacity: 100 },
            bookings: [{ tickets: [{ id: 't-1' }, { id: 't-2' }, { id: 't-3' }] }],
          },
          {
            id: 'sched-tomorrow',
            departureTime: new Date(Date.now() + 30 * 3600000),
            arrivalTime: new Date(Date.now() + 31 * 3600000),
            gate: 'Gate 1',
            captain: 'Capt. Nemo',
            status: TripStatus.ON_TIME,
            availableSeats: 90,
            route: {
              id: 'route-1',
              departurePort: { name: 'Port A', code: 'PTA', timeZone: 'America/Anguilla' },
              destinationPort: { name: 'Port B', code: 'PTB', timeZone: 'America/Anguilla' },
            },
            ferry: { id: 'f-1', name: 'Nautilus', capacity: 100 },
            bookings: [],
          },
        ]) as any);

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
      expect(overview.todayDepartures[0].id ?? 'sched-1').toBe('sched-1');
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
        .mockResolvedValueOnce(50)  // prev sold bookings (growth: sold 80 + 15 = 95 vs 50 = 90%)
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
        changePercent: 90,
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
      // Headline bookings = sold only (confirmed + checked in), so the 5 cancelled are left out.
      expect(analytics.kpis.totalBookings.value).toBe(95);
      expect(analytics.kpis.totalBookings.changePercent).toBe(90);
      // Breakdown still reports every reservation, cancelled included.
      expect(analytics.breakdowns.bookings.total).toBe(100);
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

    describe('This Month (month to date)', () => {
      const mockEmptyPlatform = () => {
        vi.mocked(prisma.operatorProfile.count).mockResolvedValue(1);
        vi.mocked(prisma.user.count).mockResolvedValue(1);
        vi.mocked(prisma.ferry.count).mockResolvedValue(1);
        vi.mocked(prisma.booking.count).mockResolvedValue(0);
        vi.mocked(prisma.ticket.count).mockResolvedValue(0);
        vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amountCents: 0 } } as any);
        vi.mocked(prisma.operatorProfile.findMany).mockResolvedValue([]);
        vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
      };

      /** The `createdAt` filters the service sent to prisma.booking.count. */
      const bookingCountRanges = () =>
        vi
          .mocked(prisma.booking.count)
          .mock.calls.map((c) => (c[0] as any)?.where?.createdAt)
          .filter(Boolean);

      afterEach(() => {
        vi.useRealTimers();
      });

      it('runs from the 1st of this month to today, with one bar per day early in the month', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-05T10:00:00.000Z'));
        mockEmptyPlatform();

        const analytics = await DashboardService.getAdminAnalyticsOverview('this-month');

        expect(analytics.period.key).toBe('this-month');
        expect(analytics.period.label).toBe('This Month (Nov 2026)');
        expect(analytics.period.days).toBe(5);
        expect(new Date(analytics.period.startDate).toISOString()).toBe('2026-11-01T00:00:00.000Z');
        expect(new Date(analytics.period.endDate).toISOString()).toBe('2026-11-05T23:59:59.999Z');
        expect(analytics.charts.revenueTrend.revenue.map((p: any) => p.label)).toEqual([
          'Nov 1', 'Nov 2', 'Nov 3', 'Nov 4', 'Nov 5'
        ]);

        // Compared with the same 5 days of last month (Oct 1 up to, not including, Oct 6).
        expect(bookingCountRanges()).toContainEqual({
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lt: new Date('2026-10-06T00:00:00.000Z'),
        });
      });

      it('switches to weekly bars after the first week', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-20T10:00:00.000Z'));
        mockEmptyPlatform();

        const analytics = await DashboardService.getAdminAnalyticsOverview('this-month');

        expect(analytics.period.days).toBe(20);
        expect(analytics.charts.revenueTrend.bookings.map((p: any) => p.label)).toEqual([
          'W1', 'W2', 'W3'
        ]);
      });

      it('never lets the comparison run past the end of a shorter previous month', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-31T10:00:00.000Z'));
        mockEmptyPlatform();

        await DashboardService.getAdminAnalyticsOverview('this-month');

        // February 2026 has 28 days: the comparison stops at Mar 1, not Mar 3.
        expect(bookingCountRanges()).toContainEqual({
          gte: new Date('2026-02-01T00:00:00.000Z'),
          lt: new Date('2026-03-01T00:00:00.000Z'),
        });
      });
    });

    it('returns null growth (not a made up +100%) when the previous period had nothing', async () => {
      vi.mocked(prisma.operatorProfile.count).mockResolvedValue(1);
      vi.mocked(prisma.user.count).mockResolvedValue(1);
      vi.mocked(prisma.ferry.count).mockResolvedValue(1);
      vi.mocked(prisma.booking.count)
        .mockResolvedValueOnce(10) // period total
        .mockResolvedValueOnce(10) // period confirmed
        .mockResolvedValueOnce(0)  // period checkedIn
        .mockResolvedValueOnce(0)  // period cancelled
        .mockResolvedValueOnce(0)  // prev bookings count: nothing to compare with
        .mockResolvedValueOnce(10); // all-time bookings
      vi.mocked(prisma.ticket.count)
        .mockResolvedValueOnce(20) // period pax
        .mockResolvedValueOnce(0)  // period boarded
        .mockResolvedValueOnce(0)  // prev pax
        .mockResolvedValueOnce(20); // all-time pax
      vi.mocked(prisma.payment.aggregate)
        .mockResolvedValueOnce({
          _sum: { amountCents: 50000, platformCommissionCents: 5000, operatorPayoutCents: 45000 },
        } as any)
        .mockResolvedValueOnce({ _sum: { amountCents: 0 } } as any) // prev gross
        .mockResolvedValueOnce({ _sum: { amountCents: 50000 } } as any);
      vi.mocked(prisma.operatorProfile.findMany).mockResolvedValue([]);
      vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

      const analytics = await DashboardService.getAdminAnalyticsOverview(30);

      expect(analytics.kpis.netRevenue.changePercent).toBeNull();
      expect(analytics.kpis.netRevenue.trend).toBe('neutral');
      expect(analytics.kpis.totalBookings.changePercent).toBeNull();
      expect(analytics.kpis.totalPassengers.changePercent).toBeNull();
      expect(analytics.breakdowns.financials.changePercent).toBeNull();
      expect(analytics.breakdowns.bookings.changePercent).toBeNull();
      expect(analytics.breakdowns.passengers.changePercent).toBeNull();
    });

    it("counts headline passengers and previous-period figures from sold bookings only", async () => {
      vi.mocked(prisma.operatorProfile.count).mockResolvedValue(1);
      vi.mocked(prisma.user.count).mockResolvedValue(1);
      vi.mocked(prisma.ferry.count).mockResolvedValue(1);
      vi.mocked(prisma.booking.count).mockResolvedValue(0);
      vi.mocked(prisma.ticket.count).mockResolvedValue(0);
      vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amountCents: 0 } } as any);
      vi.mocked(prisma.operatorProfile.findMany).mockResolvedValue([]);
      vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

      await DashboardService.getAdminAnalyticsOverview(30);

      const sold = { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] };
      const ticketWheres = vi.mocked(prisma.ticket.count).mock.calls.map((c: any) => c[0]?.where);
      // [0] period pax, [2] previous pax: cancelled bookings are not travelling.
      expect(ticketWheres[0].booking.status).toEqual(sold);
      expect(ticketWheres[2].booking.status).toEqual(sold);
      const bookingWheres = vi.mocked(prisma.booking.count).mock.calls.map((c: any) => c[0]?.where);
      // [4] previous bookings: compared like with like against the sold headline.
      expect(bookingWheres[4].status).toEqual(sold);
    });
  });
});
