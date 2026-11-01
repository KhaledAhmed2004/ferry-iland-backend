import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { RouteStatus, TripStatus, VesselStatus } from '@prisma/client';
import { ScheduleService } from '../schedule.service';
import { prisma } from '../../../../shared/prisma';

vi.mock('../../../../shared/prisma', () => {
  const prisma: any = {
    // Schedule writes run inside a per-ferry locked transaction; the mock just runs the callback.
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    $executeRaw: vi.fn(),
    operatorProfile: {
      findUnique: vi.fn(),
    },
    route: {
      findUnique: vi.fn(),
    },
    ferry: {
      findUnique: vi.fn(),
    },
    port: {
      findFirst: vi.fn(),
    },
    offDay: {
      findFirst: vi.fn(),
    },
    schedule: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return { prisma };
});

describe('ScheduleService Unit Tests', () => {
  const mockOperator = {
    id: 'op-1',
    userId: 'user-op-1',
    companyName: 'Island Express',
  };

  const mockRoute = {
    id: 'route-1',
    operatorId: 'op-1',
    departurePortId: 'port-male',
    destinationPortId: 'port-maafushi',
    status: RouteStatus.ACTIVE,
  };

  const mockFerry = {
    id: 'ferry-1',
    operatorId: 'op-1',
    name: 'Ocean Speed 1',
    capacity: 50,
    status: VesselStatus.IN_SERVICE,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSchedule', () => {
    it('creates schedule when buffer, route, and vessel are valid', async () => {
      const departureTime = new Date('2026-10-20T08:30:00.000Z');
      const arrivalTime = new Date('2026-10-20T09:15:00.000Z');

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.route.findUnique).mockResolvedValue(mockRoute as any);
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue(mockFerry as any);
      vi.mocked(prisma.schedule.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.schedule.create).mockResolvedValue({
        id: 'sch-1',
        routeId: 'route-1',
        ferryId: 'ferry-1',
        departureTime,
        arrivalTime,
        availableSeats: 50,
        status: TripStatus.ON_TIME,
      } as any);

      const result = await ScheduleService.createSchedule('user-op-1', {
        routeId: 'route-1',
        ferryId: 'ferry-1',
        departureTime,
        arrivalTime,
        adultFare: 25,
        childFare: 15,
      });

      expect(result).toMatchObject({
        id: 'sch-1',
        availableSeats: 50,
        status: TripStatus.ON_TIME,
      });
      expect(prisma.schedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            availableSeats: 50,
            adultFare: 25,
            childFare: 15,
          }),
        }),
      );
    });

    it('throws 400 when vessel has a scheduling conflict during the trip window', async () => {
      const departureTime = new Date('2026-10-20T09:30:00.000Z');
      const arrivalTime = new Date('2026-10-20T10:15:00.000Z');

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.route.findUnique).mockResolvedValue(mockRoute as any);
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue(mockFerry as any);
      vi.mocked(prisma.schedule.findFirst).mockResolvedValue({
        id: 'prior-trip',
        ferryId: 'ferry-1',
        departureTime: new Date('2026-10-20T09:00:00.000Z'),
        arrivalTime: new Date('2026-10-20T10:00:00.000Z'),
      } as any);

      await expect(
        ScheduleService.createSchedule('user-op-1', {
          routeId: 'route-1',
          ferryId: 'ferry-1',
          departureTime,
          arrivalTime,
          adultFare: 25,
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.BAD_REQUEST,
        message: expect.stringContaining('Vessel schedule conflict'),
      });
    });

    it('throws 400 if route is inactive', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.route.findUnique).mockResolvedValue({
        ...mockRoute,
        status: RouteStatus.INACTIVE,
      } as any);
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue(mockFerry as any);

      await expect(
        ScheduleService.createSchedule('user-op-1', {
          routeId: 'route-1',
          ferryId: 'ferry-1',
          departureTime: new Date('2026-10-20T08:30:00.000Z'),
          arrivalTime: new Date('2026-10-20T09:15:00.000Z'),
          adultFare: 25,
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.BAD_REQUEST,
        message: 'Cannot schedule trips on an inactive route',
      });
    });

    it('throws 400 if vessel is in maintenance', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.route.findUnique).mockResolvedValue(mockRoute as any);
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue({
        ...mockFerry,
        status: VesselStatus.MAINTENANCE,
      } as any);

      await expect(
        ScheduleService.createSchedule('user-op-1', {
          routeId: 'route-1',
          ferryId: 'ferry-1',
          departureTime: new Date('2026-10-20T08:30:00.000Z'),
          arrivalTime: new Date('2026-10-20T09:15:00.000Z'),
          adultFare: 25,
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.BAD_REQUEST,
        message: 'Vessel is currently not IN_SERVICE',
      });
    });
  });

  describe('updateScheduleStatus', () => {
    it('updates departure status successfully', async () => {
      const mockSchedule = {
        id: 'sch-1',
        route: { operatorId: 'op-1' },
        status: TripStatus.ON_TIME,
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.schedule.findUnique).mockResolvedValue(
        mockSchedule as any,
      );
      vi.mocked(prisma.schedule.update).mockResolvedValue({
        ...mockSchedule,
        status: TripStatus.BOARDING,
      } as any);

      const result = await ScheduleService.updateScheduleStatus(
        'user-op-1',
        'sch-1',
        TripStatus.BOARDING,
      );

      expect(result.status).toBe(TripStatus.BOARDING);
      expect(prisma.schedule.update).toHaveBeenCalledWith({
        where: { id: 'sch-1' },
        data: { status: TripStatus.BOARDING },
      });
    });
  });

  describe('deleteSchedule', () => {
    it('throws 400 if schedule has existing customer bookings', async () => {
      const mockSchedule = {
        id: 'sch-1',
        route: { operatorId: 'op-1' },
        _count: { bookings: 3 },
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.schedule.findUnique).mockResolvedValue(
        mockSchedule as any,
      );

      await expect(
        ScheduleService.deleteSchedule('user-op-1', 'sch-1'),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.BAD_REQUEST,
        message: 'Cannot delete schedule with existing customer bookings',
      });
    });

    it('deletes schedule if no bookings exist', async () => {
      const mockSchedule = {
        id: 'sch-1',
        route: { operatorId: 'op-1' },
        _count: { bookings: 0 },
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.schedule.findUnique).mockResolvedValue(
        mockSchedule as any,
      );
      vi.mocked(prisma.schedule.delete).mockResolvedValue(mockSchedule as any);

      const result = await ScheduleService.deleteSchedule('user-op-1', 'sch-1');
      expect(result.message).toBe('Schedule slot deleted successfully');
      expect(prisma.schedule.delete).toHaveBeenCalledWith({
        where: { id: 'sch-1' },
      });
    });
  });

  describe('searchTrips', () => {
    const mockMalePort = {
      id: 'port-male',
      name: 'Malé Terminal',
      code: 'MLE',
    };
    const mockMaafushiPort = {
      id: 'port-maafushi',
      name: 'Maafushi Island',
      code: 'MAA',
    };

    it('returns empty results when ports cannot be resolved', async () => {
      vi.mocked(prisma.port.findFirst).mockResolvedValue(null);

      const result = await ScheduleService.searchTrips({
        tripType: 'one-way',
        from: 'non-existing',
        to: 'nowhere',
        departureDate: '2026-10-20',
        adults: 2,
      });

      expect(result.outboundTrips).toEqual([]);
      expect(result.message).toContain('No ferry trips found');
    });

    it('finds one-way trips and calculates total passenger price', async () => {
      vi.mocked(prisma.port.findFirst)
        .mockResolvedValueOnce(mockMalePort as any)
        .mockResolvedValueOnce(mockMaafushiPort as any);

      const mockOutboundSchedule = {
        id: 'TRIP-101',
        departureTime: new Date('2026-10-20T08:30:00.000Z'),
        arrivalTime: new Date('2026-10-20T09:15:00.000Z'),
        availableSeats: 24,
        adultFare: 25,
        childFare: 15,
        route: {
          operator: { companyName: 'Island Express' },
        },
        ferry: { name: 'Ocean Speed 1' },
      };

      vi.mocked(prisma.schedule.findMany).mockResolvedValue([
        mockOutboundSchedule as any,
      ]);

      const result = await ScheduleService.searchTrips({
        tripType: 'one-way',
        from: 'MLE',
        to: 'MAA',
        departureDate: '2026-10-20',
        adults: 2,
        children: 1,
      });

      expect(result.outboundTrips).toHaveLength(1);
      expect(result.returnTrips).toEqual([]);
      expect(result.outboundTrips[0]).toMatchObject({
        tripId: 'TRIP-101',
        operator: 'Island Express',
        vessel: 'Ocean Speed 1',
        availableSeats: 24,
        pricePerAdult: 25,
        pricePerChild: 15,
        totalPrice: 65,
      });
    });

    it('finds round-trip journeys with returnTrips populated', async () => {
      vi.mocked(prisma.port.findFirst)
        .mockResolvedValueOnce(mockMalePort as any)
        .mockResolvedValueOnce(mockMaafushiPort as any);

      const outbound = {
        id: 'TRIP-OUT',
        departureTime: new Date('2026-10-20T08:30:00.000Z'),
        arrivalTime: new Date('2026-10-20T09:15:00.000Z'),
        availableSeats: 20,
        adultFare: 20,
        childFare: 10,
        route: { operator: { companyName: 'Island Express' } },
        ferry: { name: 'Boat 1' },
      };

      const inbound = {
        id: 'TRIP-IN',
        departureTime: new Date('2026-10-25T14:00:00.000Z'),
        arrivalTime: new Date('2026-10-25T14:45:00.000Z'),
        availableSeats: 15,
        adultFare: 20,
        childFare: 10,
        route: { operator: { companyName: 'Island Express' } },
        ferry: { name: 'Boat 2' },
      };

      vi.mocked(prisma.schedule.findMany)
        .mockResolvedValueOnce([outbound as any])
        .mockResolvedValueOnce([inbound as any]);

      const result = await ScheduleService.searchTrips({
        tripType: 'round-trip',
        from: 'MLE',
        to: 'MAA',
        departureDate: '2026-10-20',
        returnDate: '2026-10-25',
        adults: 1,
        children: 0,
      });

      expect(result.outboundTrips).toHaveLength(1);
      expect(result.returnTrips).toHaveLength(1);
      expect(result.outboundTrips[0].tripId).toBe('TRIP-OUT');
      expect(result.returnTrips[0].tripId).toBe('TRIP-IN');
    });
  });

  describe('bulkUpdateScheduleStatus', () => {
    it('successfully updates multiple schedules status in a single query', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(mockOperator as any);
      vi.mocked(prisma.schedule.updateMany).mockResolvedValue({ count: 3 });

      const result = await ScheduleService.bulkUpdateScheduleStatus(
        'user-op-1',
        ['s-1', 's-2', 's-3'],
        TripStatus.DEPARTED,
      );

      expect(result.count).toBe(3);
      expect(result.message).toContain('Successfully updated 3 schedules to DEPARTED');
      expect(prisma.schedule.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['s-1', 's-2', 's-3'] },
          route: { operatorId: mockOperator.id },
        },
        data: { status: TripStatus.DEPARTED },
      });
    });
  });

  describe('bulkDeleteSchedules', () => {
    it('successfully deletes multiple schedules when none have bookings', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(mockOperator as any);
      vi.mocked(prisma.schedule.findMany).mockResolvedValue([]);
      vi.mocked(prisma.schedule.deleteMany).mockResolvedValue({ count: 2 });

      const result = await ScheduleService.bulkDeleteSchedules('user-op-1', ['s-1', 's-2']);

      expect(result.count).toBe(2);
      expect(result.deletedCount).toBe(2);
      expect(result.skippedCount).toBe(0);
      expect(result.message).toBe('Successfully deleted 2 schedules');
    });

    it('partially deletes available schedules while skipping ones with active bookings', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(mockOperator as any);
      vi.mocked(prisma.schedule.findMany).mockResolvedValue([
        {
          id: 's-1',
          departureTime: new Date('2026-10-25T10:00:00Z'),
          route: {
            departurePort: { name: 'Port A' },
            destinationPort: { name: 'Port B' },
          },
        },
      ] as any);
      vi.mocked(prisma.schedule.deleteMany).mockResolvedValue({ count: 1 });

      const result = await ScheduleService.bulkDeleteSchedules('user-op-1', ['s-1', 's-2']);

      expect(result.count).toBe(1);
      expect(result.deletedCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.skippedSchedules).toEqual(['"Port A ➔ Port B"']);
      expect(result.message).toContain('Deleted 1 schedules. 1 schedule was skipped');
    });

    it('throws 409 CONFLICT if ALL selected schedules have active bookings', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(mockOperator as any);
      vi.mocked(prisma.schedule.findMany).mockResolvedValue([
        {
          id: 's-1',
          departureTime: new Date('2026-10-25T10:00:00Z'),
          route: {
            departurePort: { name: 'Port A' },
            destinationPort: { name: 'Port B' },
          },
        },
      ] as any);

      await expect(
        ScheduleService.bulkDeleteSchedules('user-op-1', ['s-1']),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.CONFLICT,
        message: expect.stringContaining('existing customer bookings confirmed'),
      });
    });
  });
});
