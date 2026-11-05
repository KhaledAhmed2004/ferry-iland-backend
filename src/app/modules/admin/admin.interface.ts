export interface IPlatformSettingsResponse {
  id: string;
  platformName: string;
  supportEmail: string;
  commissionRate: number;
  payoutSchedule: string;
  seatHoldMinutes: number;
  updatedAt: Date;
}

/** Columns the admin payments list can be sorted by (`?sortBy=`). */
export const ADMIN_PAYMENT_SORT_FIELDS = [
  'createdAt',
  'bookingAmount',
  'commission',
  'providerAmount',
  'paymentStatus',
  'bookingReference',
] as const;

export type AdminPaymentSortField = (typeof ADMIN_PAYMENT_SORT_FIELDS)[number];
