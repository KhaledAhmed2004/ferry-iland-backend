import { BoardingStatus, CabinClass, TripStatus } from '@prisma/client';

export interface IBoardPassengerPayload {
  boarded?: boolean;
  luggageCount?: number;
}

export interface IManifestPassengerRecord {
  ticketId: string;
  ticketNumber: string;
  bookingReference: string;
  passengerName: string;
  nationality: string;
  passportOrId: string;
  cabinClass: CabinClass;
  luggageCount: number;
  boardingStatus: BoardingStatus;
  boardedAt: Date | null;
}

export interface ITripManifestResponse {
  tripInfo: {
    tripId: string;
    vesselName: string;
    captain: string | null;
    departurePort: string;
    destinationPort: string;
    departureTime: Date;
    arrivalTime: Date;
    tripStatus: TripStatus;
    totalPassengers: number;
    boardedPassengers: number;
  };
  passengers: IManifestPassengerRecord[];
}
