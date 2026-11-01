import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminService } from '../admin.service';
import { prisma } from '../../../../shared/prisma';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    platformSetting: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('AdminService Platform Settings Unit Tests', () => {
  const mockSettings = {
    id: 'setting-1',
    platformName: 'FerryGo',
    supportEmail: 'support@ferrygo.com',
    commissionRate: 10.0,
    payoutSchedule: 'WEEKLY',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPlatformSettings', () => {
    it('returns existing platform settings if already present', async () => {
      vi.mocked(prisma.platformSetting.findFirst).mockResolvedValue(
        mockSettings as any,
      );

      const result = await AdminService.getPlatformSettings();

      expect(result.platformName).toBe('FerryGo');
      expect(result.commissionRate).toBe(10.0);
    });

    it('creates default platform settings if none exist', async () => {
      vi.mocked(prisma.platformSetting.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.platformSetting.create).mockResolvedValue(
        mockSettings as any,
      );

      const result = await AdminService.getPlatformSettings();

      expect(result.platformName).toBe('FerryGo');
      expect(prisma.platformSetting.create).toHaveBeenCalled();
    });
  });

  describe('updateCommissionSettings', () => {
    it('updates commission rate and payout schedule', async () => {
      vi.mocked(prisma.platformSetting.findFirst).mockResolvedValue(
        mockSettings as any,
      );
      vi.mocked(prisma.platformSetting.update).mockResolvedValue({
        ...mockSettings,
        commissionRate: 12.5,
        payoutSchedule: 'MONTHLY',
      } as any);

      const result = await AdminService.updateCommissionSettings({
        rate: 12.5,
        schedule: 'MONTHLY',
      });

      expect(result.commissionRate).toBe(12.5);
      expect(result.payoutSchedule).toBe('MONTHLY');
      expect(prisma.platformSetting.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            commissionRate: 12.5,
            payoutSchedule: 'MONTHLY',
          }),
        }),
      );
    });
  });

  describe('updatePlatformInfo', () => {
    it('updates platform name and support email', async () => {
      vi.mocked(prisma.platformSetting.findFirst).mockResolvedValue(
        mockSettings as any,
      );
      vi.mocked(prisma.platformSetting.update).mockResolvedValue({
        ...mockSettings,
        platformName: 'IslandExpress',
        supportEmail: 'help@islandexpress.com',
      } as any);

      const result = await AdminService.updatePlatformInfo({
        name: 'IslandExpress',
        email: 'help@islandexpress.com',
      });

      expect(result.platformName).toBe('IslandExpress');
      expect(result.supportEmail).toBe('help@islandexpress.com');
      expect(prisma.platformSetting.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            platformName: 'IslandExpress',
            supportEmail: 'help@islandexpress.com',
          }),
        }),
      );
    });
  });
});
