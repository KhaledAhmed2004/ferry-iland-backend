import { TripStatus } from '@prisma/client';

export interface ICreateSchedulePayload {
  routeId: string;
  ferryId: string;
  departureTime: string | Date;
  arrivalTime: string | Date;
  gate?: string;
  captain?: string;
  adultFare: number;
  childFare?: number;
  availableSeats?: number;
}

export interface IUpdateSchedulePayload {
  departureTime?: string | Date;
  arrivalTime?: string | Date;
  gate?: string;
  captain?: string;
  adultFare?: number;
  childFare?: number;
  availableSeats?: number;
}

export interface IUpdateScheduleStatusPayload {
  status: TripStatus;
}

export interface IScheduleFilterOptions {
  routeId?: string;
  ferryId?: string;
  date?: string;
  status?: TripStatus;
  page?: number;
  limit?: number;
}

export interface ITripSearchQuery {
  tripType: 'one-way' | 'round-trip';
  from: string;
  to: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  children?: number;
  limit?: number;
  cursor?: string;
}

export interface ISearchedTripResult {
  tripId: string;
  operator: string;
  vessel: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  availableSeats: number;
  pricePerAdult: number;
  pricePerChild: number;
  totalPrice: number;
  image?: string | null;
  vesselType?: string;
  departurePort?: string;
  departurePortId?: string;
  destinationPort?: string;
  destinationPortId?: string;
}

export interface ITripSearchResponse {
  message?: string;
  pagination: {
    nextCursor: string | null;
    hasNextPage: boolean;
    limit: number;
  };
  outboundTrips: ISearchedTripResult[];
  returnTrips: ISearchedTripResult[];
}
