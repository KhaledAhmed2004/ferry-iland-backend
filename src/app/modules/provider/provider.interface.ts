import { AccountStatus } from '@prisma/client';

export interface IProviderStatusUpdatePayload {
  status: AccountStatus;
  reason?: string;
}

export interface IOperatorSettingsUpdatePayload {
  companyName?: string;
  contactPersonName?: string;
  contactEmail?: string;
  businessAddress?: string;
  /** Set by fileHandler from the uploaded `logo` file: the stored file's public URL. */
  logo?: string;
  /** true clears the current logo. */
  removeLogo?: boolean;
}

/** Columns the admin operator list can be sorted by (`?sortBy=`). */
export const PROVIDER_SORT_FIELDS = [
  'createdAt',
  'companyName',
  'contactPersonName',
  'status',
  'ferriesCount',
  'routesCount',
] as const;

export type ProviderSortField = (typeof PROVIDER_SORT_FIELDS)[number];

export interface IProviderFilterRequest {
  searchTerm?: string;
  status?: AccountStatus;
  page?: number;
  limit?: number;
  sortBy?: ProviderSortField;
  sortOrder?: 'asc' | 'desc';
}

export interface IProviderListResult {
  id: string;
  userId: string;
  companyName: string;
  contactPersonName: string;
  contactEmail: string | null;
  businessAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    email: string;
    name: string;
    status: AccountStatus;
  };
  ferriesCount: number;
  routesCount: number;
  schedulesCount: number;
}
