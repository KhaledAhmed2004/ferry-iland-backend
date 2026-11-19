import { VesselStatus, VesselType } from '@prisma/client';

export interface ICreateFerryPayload {
  name: string;
  capacity: number;
  type?: VesselType;
  status?: VesselStatus;
  imageUrl?: string;
  amenities?: string[];
  routeIds?: string[];
}

export interface IUpdateFerryPayload {
  name?: string;
  capacity?: number;
  type?: VesselType;
  status?: VesselStatus;
  imageUrl?: string;
  amenities?: string[];
  routeIds?: string[];
}

export interface IFerryFilterOptions {
  search?: string;
  status?: VesselStatus;
  type?: VesselType;
  routeId?: string;
  page?: number;
  limit?: number;
}
