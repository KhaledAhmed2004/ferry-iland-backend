import { VesselStatus, VesselType } from '@prisma/client';

export interface ICreateFerryPayload {
  name: string;
  capacity: number;
  type?: VesselType;
  status?: VesselStatus;
  imageUrl?: string;
  amenities?: string[];
  /** Optional dedicated routes. Empty or omitted = the ferry may sail any route. */
  routeIds?: string[];
}

export interface IUpdateFerryPayload {
  name?: string;
  capacity?: number;
  type?: VesselType;
  status?: VesselStatus;
  imageUrl?: string;
  amenities?: string[];
  /** Replaces the dedicated routes. [] clears them (any route); omitted leaves them unchanged. */
  routeIds?: string[];
}

export interface IFerryFilterOptions {
  search?: string;
  status?: VesselStatus;
  type?: VesselType;
  /** Only ferries allowed on this route: dedicated to it, or not dedicated to any route. */
  routeId?: string;
  page?: number;
  limit?: number;
}
