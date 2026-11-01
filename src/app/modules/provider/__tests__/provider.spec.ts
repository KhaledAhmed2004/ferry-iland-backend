import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { AccountStatus, TripStatus } from '@prisma/client';
import { ProviderService } from '../provider.service';
import { prisma } from '../../../../shared/prisma';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    operatorProfile: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    schedule: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(callback =>
      callback({
        user: {
          update: vi.fn(),
        },
        schedule: {
          findMany: vi.fn(),
          updateMany: vi.fn(),
        },
        operatorProfile: {
          findUnique: vi.fn(),
        },
      }),
    ),
  },
}));

describe('ProviderService Unit Tests', () => {
  const mockProvider = {
    id: 'provider-uuid-1',
    userId: 'user-uuid-1',
    companyName: 'Island Ferry Co.',
    contactPersonName: 'Captain James',
    contactEmail: 'james@islandferry.com',
    businessAddress: 'Pier 4, Honolulu Harbor',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    user: {
      id: 'user-uuid-1',
      email: 'james@islandferry.com',
      name: 'Captain James',
      status: AccountStatus.ACTIVE,
    },
    _count: {
      ferries: 4,
      routes: 2,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listProviders', () => {
    it('returns paginated providers list with vessel and route counts', async () => {
      vi.mocked(prisma.operatorProfile.count).mockResolvedValue(1);
      vi.mocked(prisma.operatorProfile.findMany).mockResolvedValue([
        mockProvider as any,
      ]);

      const result = await ProviderService.listProviders({ page: 1, limit: 10 });

      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].companyName).toBe('Island Ferry Co.');
      expect(result.data[0].ferriesCount).toBe(4);
      expect(result.data[0].routesCount).toBe(2);
    });

    it('filters providers by searchTerm and account status', async () => {
      vi.mocked(prisma.operatorProfile.count).mockResolvedValue(1);
      vi.mocked(prisma.operatorProfile.findMany).mockResolvedValue([
        mockProvider as any,
      ]);

      await ProviderService.listProviders({
        searchTerm: 'Island',
        status: AccountStatus.ACTIVE,
      });

      expect(prisma.operatorProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: { status: AccountStatus.ACTIVE },
            OR: expect.arrayContaining([
              { companyName: { contains: 'Island', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });
  });

  describe('getProviderById', () => {
    it('returns full provider audit details when provider exists', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue({
        ...mockProvider,
        ferries: [{ id: 'ferry-1', name: 'Ocean Voyager' }],
        routes: [{ id: 'route-1', durationMinutes: 60 }],
      } as any);

      const result = await ProviderService.getProviderById('provider-uuid-1');

      expect(result.id).toBe('provider-uuid-1');
      expect(result.companyName).toBe('Island Ferry Co.');
    });

    it('throws 404 when provider is not found', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(null);

      await expect(
        ProviderService.getProviderById('non-existent-provider'),
      ).rejects.toThrowError('Ferry provider profile not found');
    });
  });

  describe('updateProviderStatus', () => {
    it('suspends provider and cancels upcoming trips with zero bookings', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockProvider as any,
      );

      const mockTx = {
        user: {
          update: vi.fn().mockResolvedValue({ status: AccountStatus.SUSPENDED }),
        },
        session: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        schedule: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 'sched-empty-1' }, { id: 'sched-empty-2' }]),
          updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        operatorProfile: {
          findUnique: vi.fn().mockResolvedValue({
            ...mockProvider,
            user: {
              ...mockProvider.user,
              status: AccountStatus.SUSPENDED,
            },
          }),
        },
      };

      vi.mocked(prisma.$transaction).mockImplementation(async callback =>
        callback(mockTx as any),
      );

      const result = await ProviderService.updateProviderStatus(
        'provider-uuid-1',
        {
          status: AccountStatus.SUSPENDED,
          reason: 'Regulatory investigation',
        },
      );

      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { status: AccountStatus.SUSPENDED },
      });
      expect(mockTx.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1', revokedAt: null },
        data: { revokedAt: expect.any(Date), revokedReason: 'USER_REVOKED' },
      });
      expect(mockTx.schedule.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['sched-empty-1', 'sched-empty-2'] } },
        data: { status: TripStatus.CANCELLED },
      });
      expect(result.deactivatedTripsCount).toBe(2);
      expect(result.provider?.user.status).toBe(AccountStatus.SUSPENDED);
    });

    it('activates a suspended provider without touching trip schedules', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue({
        ...mockProvider,
        user: {
          ...mockProvider.user,
          status: AccountStatus.SUSPENDED,
        },
      } as any);

      const mockTx = {
        user: {
          update: vi.fn().mockResolvedValue({ status: AccountStatus.ACTIVE }),
        },
        session: {
          updateMany: vi.fn(),
        },
        schedule: {
          findMany: vi.fn(),
          updateMany: vi.fn(),
        },
        operatorProfile: {
          findUnique: vi.fn().mockResolvedValue({
            ...mockProvider,
            user: {
              ...mockProvider.user,
              status: AccountStatus.ACTIVE,
            },
          }),
        },
      };

      vi.mocked(prisma.$transaction).mockImplementation(async callback =>
        callback(mockTx as any),
      );

      const result = await ProviderService.updateProviderStatus(
        'provider-uuid-1',
        {
          status: AccountStatus.ACTIVE,
        },
      );

      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { status: AccountStatus.ACTIVE },
      });
      expect(mockTx.session.updateMany).not.toHaveBeenCalled();
      expect(mockTx.schedule.updateMany).not.toHaveBeenCalled();
      expect(result.deactivatedTripsCount).toBe(0);
      expect(result.provider?.user.status).toBe(AccountStatus.ACTIVE);
    });
  });

  describe('getOperatorSettings', () => {
    it('returns operator settings for authenticated operator', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockProvider as any,
      );

      const result = await ProviderService.getOperatorSettings('user-uuid-1');

      expect(result.companyName).toBe('Island Ferry Co.');
    });

    it('throws 404 when operator profile does not exist', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(null);

      await expect(
        ProviderService.getOperatorSettings('unknown-user'),
      ).rejects.toThrowError(
        'Operator company profile not found for authenticated user',
      );
    });
  });

  describe('updateOperatorSettings', () => {
    it('updates operator settings successfully', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockProvider as any,
      );
      vi.mocked(prisma.operatorProfile.update).mockResolvedValue({
        ...mockProvider,
        companyName: 'Island Ferry Global Ltd.',
      } as any);

      const result = await ProviderService.updateOperatorSettings(
        'user-uuid-1',
        {
          companyName: 'Island Ferry Global Ltd.',
        },
      );

      expect(result.companyName).toBe('Island Ferry Global Ltd.');
      expect(prisma.operatorProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-uuid-1' },
          data: expect.objectContaining({
            companyName: 'Island Ferry Global Ltd.',
          }),
        }),
      );
    });
  });
});
