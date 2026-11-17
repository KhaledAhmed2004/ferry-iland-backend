export interface IPlatformSettingsResponse {
  id: string;
  platformName: string;
  supportEmail: string;
  commissionRate: number;
  payoutSchedule: string;
  seatHoldMinutes: number;
  updatedAt: Date;
}

/** Spec 0006: sort whitelists per list (`?sortBy=`); every sort ends with `id` as tie break. */
export const ADMIN_PAYMENT_SORT_FIELDS = [
  'paidAt',
  'createdAt',
  'amountCents',
  'refundedCents',
  'status',
  'bookingReference',
] as const;
export const ADMIN_REFUND_SORT_FIELDS = ['createdAt', 'amountCents', 'status'] as const;
export const ADMIN_PAYOUT_SORT_FIELDS = ['operatorNetCents', 'operatorName'] as const;

export type AdminPaymentSortField = (typeof ADMIN_PAYMENT_SORT_FIELDS)[number];
export type AdminRefundSortField = (typeof ADMIN_REFUND_SORT_FIELDS)[number];
export type AdminPayoutSortField = (typeof ADMIN_PAYOUT_SORT_FIELDS)[number];
export type SortOrder = 'asc' | 'desc';

export type IRangeQuery = { from?: string; to?: string; format?: 'json' | 'csv' };

export type IAdminPaymentsQuery = IRangeQuery & {
  page?: number;
  limit?: number;
  status?: string;
  operatorId?: string;
  search?: string;
  sortBy?: AdminPaymentSortField;
  sortOrder?: SortOrder;
};

export type IAdminRefundsQuery = IRangeQuery & {
  page?: number;
  limit?: number;
  status?: string;
  reason?: string;
  operatorId?: string;
  search?: string;
  sortBy?: AdminRefundSortField;
  sortOrder?: SortOrder;
};

export type IAdminPayoutsQuery = IRangeQuery & {
  operatorId?: string;
  sortBy?: AdminPayoutSortField;
  sortOrder?: SortOrder;
};

export type IAdminPayoutBookingsQuery = IRangeQuery & { page?: number; limit?: number };

export type IListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  stripeMode: 'live' | 'test';
};

export type IMoneyTotals = {
  bookings: number;
  grossCents: number;
  refundedCents: number;
  commissionNetCents: number;
  operatorNetCents: number;
};
