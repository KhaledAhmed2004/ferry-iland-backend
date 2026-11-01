export interface IPlatformSettingsResponse {
  id: string;
  platformName: string;
  supportEmail: string;
  commissionRate: number;
  payoutSchedule: string;
  seatHoldMinutes: number;
  updatedAt: Date;
}
