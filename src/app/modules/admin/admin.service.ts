import { prisma } from '../../../shared/prisma';
import { IPlatformSettingsResponse } from './admin.interface';
import { UpdateCommissionDTO } from './admin.validation';

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

export const AdminService = {
  getOrCreatePlatformSettings,
  getPlatformSettings,
  updateCommissionSettings,
};
