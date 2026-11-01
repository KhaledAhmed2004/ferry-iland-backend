import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { VesselStatus, VesselType } from '@prisma/client';
import { FerryService } from '../ferry.service';
import { prisma } from '../../../../shared/prisma';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    operatorProfile: {
      findUnique: vi.fn(),
    },
    ferry: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe('FerryService Unit Tests', () => {
  const mockOperator = {
    id: 'op-1',
    userId: 'user-op-1',
    companyName: 'Island Hop Express',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createFerry', () => {
    it('creates a vessel under operator profile when payload is valid', async () => {
      const payload = {
        name: 'Ocean Voyager I',
        registration: 'HI-9921-C',
        capacity: 180,
        type: VesselType.CATAMARAN,
        status: VesselStatus.IN_SERVICE,
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.ferry.create).mockResolvedValue({
        id: 'ferry-1',
        operatorId: mockOperator.id,
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await FerryService.createFerry('user-op-1', payload);

      expect(result).toMatchObject({
        id: 'ferry-1',
        operatorId: 'op-1',
        name: 'Ocean Voyager I',
        registration: 'HI-9921-C',
      });
      expect(prisma.ferry.create).toHaveBeenCalledWith({
        data: {
          operatorId: mockOperator.id,
          ...payload,
          amenities: [],
        },
      });
    });

    it('throws 403 when user does not have an operator profile', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(null);

      await expect(
        FerryService.createFerry('user-no-op', {
          name: 'Boat',
          registration: 'REG-1',
          capacity: 50,
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.FORBIDDEN,
        message: 'Operator profile not found for this user',
      });
    });

    it('throws 409 when vessel registration code already exists', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue({
        id: 'existing-ferry',
        registration: 'HI-9921-C',
      } as any);

      await expect(
        FerryService.createFerry('user-op-1', {
          name: 'Boat',
          registration: 'HI-9921-C',
          capacity: 50,
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.CONFLICT,
        message: "Vessel registration 'HI-9921-C' is already registered",
      });
    });
  });

  describe('listOperatorFerries', () => {
    it('returns operator ferries with pagination and tenant isolation', async () => {
      const mockFerries = [
        {
          id: 'ferry-1',
          name: 'Boat 1',
          operatorId: 'op-1',
          _count: { schedules: 2 },
        },
      ];

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ferry.findMany).mockResolvedValue(mockFerries as any);
      vi.mocked(prisma.ferry.count).mockResolvedValue(1);

      const result = await FerryService.listOperatorFerries('user-op-1', {
        page: 1,
        limit: 10,
        status: VesselStatus.IN_SERVICE,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].scheduleCount).toBe(2);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      expect(prisma.ferry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            operatorId: 'op-1',
            status: VesselStatus.IN_SERVICE,
          },
        }),
      );
    });

    it('correctly calculates hasNextPage and hasPreviousPage for multi-page results', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue({
        id: 'op-1',
      } as any);
      vi.mocked(prisma.ferry.findMany).mockResolvedValue([
        { id: 'f-1', name: 'Boat 1', _count: { schedules: 0 } },
      ] as any);
      vi.mocked(prisma.ferry.count).mockResolvedValue(25);

      // Page 1 of 3: hasNextPage true, hasPreviousPage false
      const page1Result = await FerryService.listOperatorFerries('user-op-1', {
        page: 1,
        limit: 10,
      });
      expect(page1Result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: false,
      });

      // Page 2 of 3: hasNextPage true, hasPreviousPage true
      const page2Result = await FerryService.listOperatorFerries('user-op-1', {
        page: 2,
        limit: 10,
      });
      expect(page2Result.meta).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });

      // Page 3 of 3: hasNextPage false, hasPreviousPage true
      const page3Result = await FerryService.listOperatorFerries('user-op-1', {
        page: 3,
        limit: 10,
      });
      expect(page3Result.meta).toEqual({
        page: 3,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });
  });

  describe('getFerryById', () => {
    it('returns ferry details when owned by operator', async () => {
      const mockFerry = {
        id: 'ferry-1',
        name: 'Boat 1',
        operatorId: 'op-1',
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue(mockFerry as any);

      const result = await FerryService.getFerryById('user-op-1', 'ferry-1');
      expect(result).toMatchObject(mockFerry);
      expect(result.scheduleCount).toBe(0);
    });

    it('throws 404 when ferry belongs to another operator (tenant check)', async () => {
      const otherOperatorFerry = {
        id: 'ferry-2',
        name: 'Competitor Boat',
        operatorId: 'op-different',
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue(
        otherOperatorFerry as any,
      );

      await expect(
        FerryService.getFerryById('user-op-1', 'ferry-2'),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
        message: 'Ferry vessel not found',
      });
    });
  });

  describe('getFerryStats', () => {
    it('calculates fleet statistics correctly', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ferry.findMany).mockResolvedValue([
        { status: VesselStatus.IN_SERVICE, capacity: 150 },
        { status: VesselStatus.IN_SERVICE, capacity: 200 },
        { status: VesselStatus.MAINTENANCE, capacity: 200 },
      ] as any);

      const result = await FerryService.getFerryStats('user-op-1');

      expect(result).toEqual({
        totalFerries: 3,
        inServiceFerries: 2,
        maintenanceFerries: 1,
        outOfServiceFerries: 0,
        totalCapacity: 550,
      });
    });
  });

  describe('updateFerry', () => {
    it('updates vessel details successfully', async () => {
      const existingFerry = {
        id: 'ferry-1',
        operatorId: 'op-1',
        name: 'Old Name',
        registration: 'REG-1',
      };
      const updatedFerry = {
        ...existingFerry,
        name: 'New Name',
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue(
        existingFerry as any,
      );
      vi.mocked(prisma.ferry.update).mockResolvedValue(updatedFerry as any);

      const result = await FerryService.updateFerry('user-op-1', 'ferry-1', {
        name: 'New Name',
      });

      expect(result).toEqual(updatedFerry);
    });

    it('throws 409 if updated registration code collides with another vessel', async () => {
      const existingFerry = {
        id: 'ferry-1',
        operatorId: 'op-1',
        registration: 'REG-1',
      };
      const collidingFerry = {
        id: 'ferry-2',
        registration: 'REG-TAKEN',
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ferry.findUnique)
        .mockResolvedValueOnce(existingFerry as any)
        .mockResolvedValueOnce(collidingFerry as any);

      await expect(
        FerryService.updateFerry('user-op-1', 'ferry-1', {
          registration: 'REG-TAKEN',
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.CONFLICT,
        message: "Vessel registration 'REG-TAKEN' is already registered",
      });
    });
  });

  describe('deleteFerry', () => {
    it('decommissions vessel to OUT_OF_SERVICE if schedules exist', async () => {
      const ferryWithSchedules = {
        id: 'ferry-1',
        operatorId: 'op-1',
        _count: { schedules: 5 },
      };
      const decommissionedFerry = {
        id: 'ferry-1',
        status: VesselStatus.OUT_OF_SERVICE,
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue(
        ferryWithSchedules as any,
      );
      vi.mocked(prisma.ferry.update).mockResolvedValue(
        decommissionedFerry as any,
      );

      const result = await FerryService.deleteFerry('user-op-1', 'ferry-1');

      expect(result.decommissioned).toBe(true);
      expect(result.message).toContain('OUT_OF_SERVICE instead of deleted');
      expect(prisma.ferry.update).toHaveBeenCalledWith({
        where: { id: 'ferry-1' },
        data: { status: VesselStatus.OUT_OF_SERVICE },
      });
      expect(prisma.ferry.delete).not.toHaveBeenCalled();
    });

    it('permanently deletes vessel if no schedules exist', async () => {
      const unusedFerry = {
        id: 'ferry-1',
        operatorId: 'op-1',
        _count: { schedules: 0 },
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue(unusedFerry as any);
      vi.mocked(prisma.ferry.delete).mockResolvedValue(unusedFerry as any);

      const result = await FerryService.deleteFerry('user-op-1', 'ferry-1');

      expect(result.decommissioned).toBe(false);
      expect(result.message).toBe('Vessel permanently deleted');
      expect(prisma.ferry.delete).toHaveBeenCalledWith({
        where: { id: 'ferry-1' },
      });
    });
  });
});
