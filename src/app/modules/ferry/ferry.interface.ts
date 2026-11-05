import { VesselStatus, VesselType } from '@prisma/client';

export interface ICreateFerryPayload {
  name: string;
  capacity: number;
  type?: VesselType;
  status?: VesselStatus;
  imageUrl?: string;
  amenities?: string[];
}

export interface IUpdateFerryPayload {
  name?: string;
  capacity?: number;
  type?: VesselType;
  status?: VesselStatus;
  imageUrl?: string;
  amenities?: string[];
}

export interface IFerryFilterOptions {
  search?: string;
  status?: VesselStatus;
  type?: VesselType;
  page?: number;
  limit?: number;
}
