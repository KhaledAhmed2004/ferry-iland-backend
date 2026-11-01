import { StatusCodes } from 'http-status-codes';
import { BoardingStatus, BookingStatus, TripStatus } from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { ITripManifestResponse } from './ticket.interface';

/** Spec 0001: only paid or manual confirmed bookings appear on manifests and passes. */
const SOLD_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
];

const assertBookingIsSold = (status: BookingStatus) => {
  if (!SOLD_BOOKING_STATUSES.includes(status)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Only confirmed bookings can board or be unboarded',
    );
  }
};

const resolveOperatorProfile = async (userId: string) => {
  const operator = await prisma.operatorProfile.findUnique({
    where: { userId },
  });

  if (!operator) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Operator profile not found for this user',
    );
  }

  return operator;
};

const getTripManifest = async (
  userId: string,
  tripId: string,
  search?: string,
  boardingStatusFilter?: BoardingStatus,
): Promise<ITripManifestResponse> => {
  const operator = await resolveOperatorProfile(userId);

  const schedule = await prisma.schedule.findUnique({
    where: { id: tripId },
    include: {
      route: {
        include: {
          departurePort: true,
          destinationPort: true,
        },
      },
      ferry: true,
    },
  });

  if (!schedule || schedule.route.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Trip schedule not found');
  }

  const whereClause: Record<string, any> = {
    booking: {
      scheduleId: tripId,
      status: { in: SOLD_BOOKING_STATUSES },
    },
  };

  if (boardingStatusFilter) {
    whereClause.boardingStatus = boardingStatusFilter;
  }

  if (search) {
    whereClause.OR = [
      { passengerName: { contains: search, mode: 'insensitive' } },
      { passportOrId: { contains: search, mode: 'insensitive' } },
      { ticketNumber: { contains: search, mode: 'insensitive' } },
      { nationality: { contains: search, mode: 'insensitive' } },
    ];
  }

  const tickets = await prisma.ticket.findMany({
    where: whereClause,
    orderBy: { passengerName: 'asc' },
    include: {
      booking: {
        select: { reference: true },
      },
    },
  });

  const totalPassengers = tickets.length;
  const boardedPassengers = tickets.filter(
    ticket => ticket.boardingStatus === BoardingStatus.BOARDED,
  ).length;

  const manifestPassengerRecords = tickets.map(ticket => ({
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    bookingReference: ticket.booking.reference,
    passengerName: ticket.passengerName,
    nationality: ticket.nationality,
    passportOrId: ticket.passportOrId,
    cabinClass: ticket.cabinClass,
    luggageCount: ticket.luggageCount,
    boardingStatus: ticket.boardingStatus,
    boardedAt: ticket.boardedAt,
  }));

  return {
    tripInfo: {
      tripId: schedule.id,
      vesselName: schedule.ferry.name,
      captain: schedule.captain,
      departurePort: schedule.route.departurePort.name,
      destinationPort: schedule.route.destinationPort.name,
      departureTime: schedule.departureTime,
      arrivalTime: schedule.arrivalTime,
      tripStatus: schedule.status,
      totalPassengers,
      boardedPassengers,
    },
    passengers: manifestPassengerRecords,
  };
};

const boardPassenger = async (
  userId: string,
  ticketId: string,
  luggageCount?: number,
) => {
  const operator = await resolveOperatorProfile(userId);

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      booking: {
        include: {
          schedule: {
            include: { route: true },
          },
        },
      },
    },
  });

  if (
    !ticket ||
    ticket.booking.schedule.route.operatorId !== operator.id
  ) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Passenger ticket not found');
  }

  assertBookingIsSold(ticket.booking.status);

  if (ticket.booking.schedule.status === TripStatus.DEPARTED) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Trip has already departed. Manifest is locked for Coast Guard compliance',
    );
  }

  return prisma.ticket.update({
    where: { id: ticketId },
    data: {
      boardingStatus: BoardingStatus.BOARDED,
      boardedAt: new Date(),
      ...(typeof luggageCount === 'number' ? { luggageCount } : {}),
    },
  });
};

const unboardPassenger = async (userId: string, ticketId: string) => {
  const operator = await resolveOperatorProfile(userId);

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      booking: {
        include: {
          schedule: {
            include: { route: true },
          },
        },
      },
    },
  });

  if (
    !ticket ||
    ticket.booking.schedule.route.operatorId !== operator.id
  ) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Passenger ticket not found');
  }

  assertBookingIsSold(ticket.booking.status);

  if (ticket.booking.schedule.status === TripStatus.DEPARTED) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Trip has already departed. Manifest is locked for Coast Guard compliance',
    );
  }

  return prisma.ticket.update({
    where: { id: ticketId },
    data: {
      boardingStatus: BoardingStatus.CHECKED_IN,
      boardedAt: null,
    },
  });
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getDigitalPass = async (identifier: string) => {
  const isUuid = UUID_REGEX.test(identifier);

  const ticket = await prisma.ticket.findFirst({
    where: {
      OR: [
        ...(isUuid ? [{ id: identifier }] : []),
        { ticketNumber: identifier },
        { booking: { reference: identifier } },
      ],
      // Unpaid, expired, or cancelled bookings have no valid boarding pass (spec 0001, AC-6).
      booking: { status: { in: SOLD_BOOKING_STATUSES } },
    },
    include: {
      booking: {
        include: {
          schedule: {
            include: {
              route: {
                include: {
                  departurePort: true,
                  destinationPort: true,
                  operator: true,
                },
              },
              ferry: true,
            },
          },
        },
      },
    },
  });

  if (!ticket) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Digital pass ticket not found');
  }

  return {
    ticketNumber: ticket.ticketNumber,
    bookingReference: ticket.booking.reference,
    passengerName: ticket.passengerName,
    nationality: ticket.nationality,
    passportOrId: ticket.passportOrId,
    cabinClass: ticket.cabinClass,
    luggageCount: ticket.luggageCount,
    boardingStatus: ticket.boardingStatus,
    boardedAt: ticket.boardedAt,
    trip: {
      tripId: ticket.booking.schedule.id,
      operatorName: ticket.booking.schedule.route.operator.companyName,
      vesselName: ticket.booking.schedule.ferry.name,
      departurePort: ticket.booking.schedule.route.departurePort.name,
      destinationPort: ticket.booking.schedule.route.destinationPort.name,
      departureTime: ticket.booking.schedule.departureTime,
      arrivalTime: ticket.booking.schedule.arrivalTime,
      gate: ticket.booking.schedule.gate,
    },
    qrCodePayload: `PASS:${ticket.ticketNumber}:${ticket.booking.reference}`,
  };
};

export const TicketService = {
  getTripManifest,
  boardPassenger,
  unboardPassenger,
  getDigitalPass,
};
