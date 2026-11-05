import { TripStatus, TripType } from '@prisma/client';

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
  tripType: 'one-way' | 'round-trip' | 'same-day-return';
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
  /** Full ISO times and operator, so the client can pair an outbound with a valid return. */
  departureAt: string;
  arrivalAt: string;
  /** IANA zones of the departure and destination ports (spec 0003). */
  departureTimeZone: string;
  arrivalTimeZone: string;
  operatorId: string;
  /** Price for the searched trip type (round trip / same day bundle, or one way). */
  fareQuote: ITripFareQuote;
}

export interface ITripFareQuote {
  tripType: TripType;
  /** false when this route does not offer the searched trip type. */
  available: boolean;
  pricePerAdult: number | null;
  pricePerChild: number | null;
  totalPrice: number | null;
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
