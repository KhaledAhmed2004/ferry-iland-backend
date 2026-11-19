import { OffDayCategory } from '@prisma/client';

export interface ICreateOffDayPayload {
  date: string | Date;
  reason: string;
  category?: OffDayCategory;
  ferryId?: string | null;
}

export interface IUpdateOffDayPayload {
  date?: string | Date;
  reason?: string;
  category?: OffDayCategory;
  ferryId?: string | null;
}

export interface IOffDayFilterOptions {
  year?: number;
  ferryId?: string;
  category?: OffDayCategory;
  page?: number;
  limit?: number;
}
