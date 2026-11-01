import { BookingStatus, CabinClass } from '@prisma/client';

export interface IPassengerInput {
  passengerName: string;
  nationality: string;
  passportOrId: string;
  cabinClass?: CabinClass;
  luggageCount?: number;
}

export interface ICreateBookingPayload {
  scheduleId: string;
  leadPassengerName: string;
  leadPassengerEmail: string;
  leadPassengerPhone?: string;
  adultsCount: number;
  childrenCount?: number;
  passengers: IPassengerInput[];
}

export interface IBookingFilterOptions {
  status?: BookingStatus;
  search?: string;
  page?: number;
  limit?: number;
}
