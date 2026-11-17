import { BookingRequestStatus } from '@prisma/client';

export type IBookingRequestListQuery = {
  status?: BookingRequestStatus;
  page?: number;
  limit?: number;
};

export type IResolveBookingRequestAction = 'CANCEL' | 'RESCHEDULE' | 'REJECT';

export type IResolveBookingRequestPayload = {
  action: IResolveBookingRequestAction;
  /** RESCHEDULE only: the new trip for each leg that moves (at least one). */
  outboundScheduleId?: string;
  returnScheduleId?: string;
  note?: string;
};

/** Who is acting: an operator is scoped to their own ferries, an admin sees everything. */
export type IStaffActor = {
  userId: string;
  role: string;
};
