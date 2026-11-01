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
}

export interface IProviderFilterRequest {
  searchTerm?: string;
  status?: AccountStatus;
  page?: number;
  limit?: number;
  sortBy?: string;
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
