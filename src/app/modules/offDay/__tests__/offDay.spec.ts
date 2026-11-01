import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { OffDayCategory } from '@prisma/client';
import { OffDayService } from '../offDay.service';
import { prisma } from '../../../../shared/prisma';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    operatorProfile: {
      findUnique: vi.fn(),
    },
    ferry: {
      findUnique: vi.fn(),
    },
    offDay: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe('OffDayService Unit Tests', () => {
  const mockOperator = { id: 'op-1', userId: 'user-op-1' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createOffDay', () => {
    it('schedules an off-day blackout when payload is valid', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue({
        id: 'ferry-1',
        operatorId: 'op-1',
      } as any);
      vi.mocked(prisma.offDay.findFirst).mockResolvedValue(null);

      const createdMockOffDay = {
        id: 'off-1',
        operatorId: 'op-1',
        ferryId: 'ferry-1',
        date: new Date('2026-11-15T00:00:00.000Z'),
        reason: 'Annual Hull Inspection',
        category: OffDayCategory.MAINTENANCE,
      };

      vi.mocked(prisma.offDay.create).mockResolvedValue(
        createdMockOffDay as any,
      );

      const result = await OffDayService.createOffDay('user-op-1', {
        date: '2026-11-15',
        reason: 'Annual Hull Inspection',
        category: OffDayCategory.MAINTENANCE,
        ferryId: 'ferry-1',
      });

      expect(result).toMatchObject({
        id: 'off-1',
        reason: 'Annual Hull Inspection',
      });
      expect(prisma.offDay.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operatorId: 'op-1',
            reason: 'Annual Hull Inspection',
          }),
        }),
      );
    });

    it('throws 404 when assigned ferry belongs to another operator', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue({
        id: 'ferry-other',
        operatorId: 'op-other',
      } as any);

      await expect(
        OffDayService.createOffDay('user-op-1', {
          date: '2026-11-15',
          reason: 'Maintenance',
          ferryId: 'ferry-other',
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
      });
    });

    it('throws 409 when blackout already exists for that date and vessel', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.offDay.findFirst).mockResolvedValue({
        id: 'existing-off',
      } as any);

      await expect(
        OffDayService.createOffDay('user-op-1', {
          date: '2026-11-15',
          reason: 'Storm warning',
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.CONFLICT,
        message: expect.stringContaining('already scheduled'),
      });
    });
  });

  describe('listOperatorOffDays', () => {
    it('returns off-days with pagination scoped to operator', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.offDay.findMany).mockResolvedValue([
        {
          id: 'off-1',
          date: new Date('2026-11-15'),
          reason: 'Maintenance',
        },
      ] as any);
      vi.mocked(prisma.offDay.count).mockResolvedValue(1);

      const result = await OffDayService.listOperatorOffDays('user-op-1', {
        page: 1,
        limit: 10,
        year: 2026,
      });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(prisma.offDay.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            operatorId: 'op-1',
          }),
        }),
      );
    });
  });

  describe('deleteOffDay', () => {
    it('deletes off-day blackout when owned by operator', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.offDay.findUnique).mockResolvedValue({
        id: 'off-1',
        operatorId: 'op-1',
      } as any);
      vi.mocked(prisma.offDay.delete).mockResolvedValue({} as any);

      const result = await OffDayService.deleteOffDay('user-op-1', 'off-1');
      expect(result.message).toBe('Off-day blackout deleted successfully');
      expect(prisma.offDay.delete).toHaveBeenCalledWith({
        where: { id: 'off-1' },
      });
    });

    it('throws 404 when off-day does not belong to operator', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.offDay.findUnique).mockResolvedValue({
        id: 'off-other',
        operatorId: 'op-other',
      } as any);

      await expect(
        OffDayService.deleteOffDay('user-op-1', 'off-other'),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
      });
    });
  });
});
