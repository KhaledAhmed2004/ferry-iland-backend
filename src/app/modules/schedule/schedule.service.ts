import { StatusCodes } from 'http-status-codes';
import {
  AccountStatus,
  Prisma,
  RouteStatus,
  TripStatus,
  TripType,
  VesselStatus,
} from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { SEARCH_TRIP_TYPE_TO_ENUM, getFarePerPassenger } from '../booking/booking.fare';
import { prisma } from '../../../shared/prisma';
import { getDynamicVesselImage } from '../../../shared/mediaCatalog';
import {
  formatLocalTime,
  localDate,
  localDayBounds,
  parseScheduleTime,
} from '../../../shared/portTime';
import {
  ICreateSchedulePayload,
  IScheduleFilterOptions,
  ISearchedTripResult,
  ITripSearchQuery,
  ITripSearchResponse,
  IUpdateSchedulePayload,
} from './schedule.interface';

const resolveOperatorProfile = async (userId: string) => {
  const operator = await prisma.operatorProfile.findUnique({
    where: { userId },
    include: { user: true },
  });

  if (!operator) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Operator profile not found for this user',
    );
  }

  if (operator.user && operator.user.status === AccountStatus.SUSPENDED) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Suspended operators cannot perform this operation',
    );
  }

  return operator;
};

type Db = Prisma.TransactionClient;

/**
 * Runs `fn` in a transaction holding a per-ferry lock, so two requests for the same
 * ferry can't both pass the clash check and insert overlapping voyages.
 */
const withVesselLock = <T>(ferryId: string, fn: (tx: Db) => Promise<T>) =>
  prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ferryId}))`;
    return fn(tx);
  });

/**
 * Off days store a calendar date as UTC midnight of `YYYY-MM-DD`. A trip falls on an off day
 * when its departure port local date is that calendar date (spec 0003, AC-8).
 */
const offDayDateFor = (departure: Date, departureTimeZone: string) =>
  new Date(`${localDate(departure, departureTimeZone)}T00:00:00.000Z`);

const assertNotBlackout = async (
  db: Db,
  operatorId: string,
  ferryId: string,
  departure: Date,
  departureTimeZone: string,
) => {
  const activeOffDay = await db.offDay.findFirst({
    where: {
      operatorId,
      date: offDayDateFor(departure, departureTimeZone),
      OR: [{ ferryId }, { ferryId: null }],
    },
  });

  if (activeOffDay) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Cannot schedule trips on a blackout date: ${activeOffDay.reason}`,
    );
  }
};

const assertWithinCapacity = (seats: number | undefined, capacity: number) => {
  if (seats !== undefined && seats > capacity) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `availableSeats (${seats}) cannot exceed the vessel capacity (${capacity})`,
    );
  }
};

const verifyVesselAvailability = async (
  db: Db,
  ferryId: string,
  departureTime: Date,
  arrivalTime: Date,
  excludeScheduleId?: string,
) => {
  const conflictingSchedule = await db.schedule.findFirst({
    where: {
      ferryId,
      status: {
        not: TripStatus.CANCELLED,
      },
      ...(excludeScheduleId ? { id: { not: excludeScheduleId } } : {}),
      departureTime: {
        lt: arrivalTime,
      },
      arrivalTime: {
        gt: departureTime,
      },
    },
  });

  if (conflictingSchedule) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Vessel schedule conflict: This vessel is already scheduled for another voyage during this time window',
    );
  }
};

const calculateDurationMinutes = (start: Date, end: Date): string => {
  const differenceMinutes = Math.round(
    (end.getTime() - start.getTime()) / (1000 * 60),
  );
  const hours = Math.floor(differenceMinutes / 60);
  const minutes = differenceMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}m`;
};

/** Arrival must follow departure, checked on the resolved instants (spec 0003, rule 8). */
const assertArrivalAfterDeparture = (departure: Date, arrival: Date) => {
  if (departure.getTime() >= arrival.getTime()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'arrivalTime must be after departureTime');
  }
};

const createSchedule = async (
  userId: string,
  payload: ICreateSchedulePayload,
) => {
  const operator = await resolveOperatorProfile(userId);

  const [route, ferry] = await Promise.all([
    prisma.route.findUnique({
      where: { id: payload.routeId },
      include: { departurePort: true, destinationPort: true },
    }),
    prisma.ferry.findUnique({
      where: { id: payload.ferryId },
    }),
  ]);

  if (!route || route.operatorId !== operator.id) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Route not found for this operator',
    );
  }

  if (route.status !== RouteStatus.ACTIVE) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Cannot schedule trips on an inactive route',
    );
  }

  if (!ferry || ferry.operatorId !== operator.id) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Vessel not found for this operator',
    );
  }

  if (ferry.status !== VesselStatus.IN_SERVICE) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Vessel is currently not IN_SERVICE',
    );
  }

  // A wall time means that time at the port: departure at its port, arrival at its port.
  const departureTimeDate = parseScheduleTime(payload.departureTime, route.departurePort.timeZone);
  const arrivalTimeDate = parseScheduleTime(payload.arrivalTime, route.destinationPort.timeZone);
  assertArrivalAfterDeparture(departureTimeDate, arrivalTimeDate);

  assertWithinCapacity(payload.availableSeats, ferry.capacity);
  const assignedCapacity = payload.availableSeats ?? ferry.capacity;

  return withVesselLock(ferry.id, async tx => {
    await assertNotBlackout(
      tx,
      operator.id,
      ferry.id,
      departureTimeDate,
      route.departurePort.timeZone,
    );
    await verifyVesselAvailability(
      tx,
      ferry.id,
      departureTimeDate,
      arrivalTimeDate,
    );

    return tx.schedule.create({
      data: {
        routeId: payload.routeId,
        ferryId: payload.ferryId,
        departureTime: departureTimeDate,
        arrivalTime: arrivalTimeDate,
        gate: payload.gate,
        captain: payload.captain,
        adultFare: payload.adultFare,
        childFare: payload.childFare ?? 0,
        availableSeats: assignedCapacity,
        status: TripStatus.ON_TIME,
      },
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
  });
};

const listOperatorSchedules = async (
  userId: string,
  options: IScheduleFilterOptions,
) => {
  const operator = await resolveOperatorProfile(userId);

  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const skip = (page - 1) * limit;

  const whereClause: Record<string, any> = {
    route: {
      operatorId: operator.id,
    },
  };

  if (options.routeId) {
    whereClause.routeId = options.routeId;
  }

  if (options.ferryId) {
    whereClause.ferryId = options.ferryId;
  }

  if (options.status) {
    whereClause.status = options.status;
  }

  if (options.date) {
    // The date is each trip's departure port local day: one branch per zone, so pagination
    // stays in the database (spec 0003, AC-7).
    const ports = await prisma.port.findMany({ select: { id: true, timeZone: true } });
    const portIdsByZone = new Map<string, string[]>();
    for (const port of ports) {
      portIdsByZone.set(port.timeZone, [...(portIdsByZone.get(port.timeZone) ?? []), port.id]);
    }
    whereClause.OR = Array.from(portIdsByZone, ([timeZone, portIds]) => {
      const { start, end } = localDayBounds(options.date!, timeZone);
      return {
        route: { departurePortId: { in: portIds } },
        departureTime: { gte: start, lte: end },
      };
    });
  }

  const [schedules, totalCount] = await Promise.all([
    prisma.schedule.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { departureTime: 'asc' },
      include: {
        route: {
          include: {
            departurePort: true,
            destinationPort: true,
          },
        },
        ferry: true,
        _count: {
          select: { bookings: true },
        },
      },
    }),
    prisma.schedule.count({ where: whereClause }),
  ]);

  return {
    meta: {
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
    data: schedules,
  };
};

const getScheduleById = async (userId: string, scheduleId: string) => {
  const operator = await resolveOperatorProfile(userId);

  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      route: {
        include: {
          departurePort: true,
          destinationPort: true,
        },
      },
      ferry: true,
      bookings: true,
    },
  });

  if (!schedule || schedule.route.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Schedule slot not found');
  }

  return schedule;
};

const updateSchedule = async (
  userId: string,
  scheduleId: string,
  payload: IUpdateSchedulePayload,
) => {
  const operator = await resolveOperatorProfile(userId);

  const existingSchedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      route: { include: { departurePort: true, destinationPort: true } },
      ferry: true,
    },
  });

  if (!existingSchedule || existingSchedule.route.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Schedule slot not found');
  }

  assertWithinCapacity(payload.availableSeats, existingSchedule.ferry.capacity);

  // A time not sent keeps its stored value; a sent wall time is read at its port (spec 0003, rule 8).
  const { departurePort, destinationPort } = existingSchedule.route;
  const newDeparture = payload.departureTime
    ? parseScheduleTime(payload.departureTime, departurePort.timeZone)
    : existingSchedule.departureTime;
  const newArrival = payload.arrivalTime
    ? parseScheduleTime(payload.arrivalTime, destinationPort.timeZone)
    : existingSchedule.arrivalTime;
  if (payload.departureTime || payload.arrivalTime) {
    assertArrivalAfterDeparture(newDeparture, newArrival);
  }

  return withVesselLock(existingSchedule.ferryId, async tx => {
    if (payload.departureTime || payload.arrivalTime) {
      await assertNotBlackout(
        tx,
        operator.id,
        existingSchedule.ferryId,
        newDeparture,
        departurePort.timeZone,
      );
      await verifyVesselAvailability(
        tx,
        existingSchedule.ferryId,
        newDeparture,
        newArrival,
        scheduleId,
      );
    }

    return tx.schedule.update({
      where: { id: scheduleId },
      data: {
        departureTime: newDeparture,
        arrivalTime: newArrival,
        gate: payload.gate,
        captain: payload.captain,
        adultFare: payload.adultFare,
        childFare: payload.childFare,
        availableSeats: payload.availableSeats,
      },
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
  });
};

const updateScheduleStatus = async (
  userId: string,
  scheduleId: string,
  newStatus: TripStatus,
) => {
  const operator = await resolveOperatorProfile(userId);

  const existingSchedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: { route: true },
  });

  if (!existingSchedule || existingSchedule.route.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Schedule slot not found');
  }

  return prisma.schedule.update({
    where: { id: scheduleId },
    data: { status: newStatus },
  });
};

const deleteSchedule = async (userId: string, scheduleId: string) => {
  const operator = await resolveOperatorProfile(userId);

  const existingSchedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      route: {
        include: {
          departurePort: { select: { name: true, timeZone: true } },
          destinationPort: { select: { name: true, timeZone: true } },
        },
      },
      _count: {
        select: { bookings: true, returnBookings: true },
      },
    },
  });

  if (!existingSchedule || existingSchedule.route.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Schedule slot not found');
  }

  if (
    (existingSchedule._count.bookings ?? 0) + (existingSchedule._count.returnBookings ?? 0) >
    0
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Cannot delete schedule with existing customer bookings',
    );
  }

  try {
    await prisma.schedule.delete({
      where: { id: scheduleId },
    });
  } catch (error: any) {
    if (
      error?.code === 'P2003' ||
      error?.code === '23001' ||
      error?.message?.includes('violates RESTRICT') ||
      error?.message?.includes('foreign key constraint')
    ) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        'Cannot delete schedule because active customer bookings are referencing it.',
      );
    }
    throw error;
  }

  return { message: 'Schedule slot deleted successfully' };
};

const bulkUpdateScheduleStatus = async (
  userId: string,
  ids: string[],
  status: TripStatus,
) => {
  const operator = await resolveOperatorProfile(userId);

  const result = await prisma.schedule.updateMany({
    where: {
      id: { in: ids },
      route: { operatorId: operator.id },
    },
    data: { status },
  });

  return {
    count: result.count,
    message: `Successfully updated ${result.count} schedules to ${status.replace(/_/g, ' ')}`,
  };
};

const bulkDeleteSchedules = async (userId: string, ids: string[]) => {
  const operator = await resolveOperatorProfile(userId);

  // 1. Identify which of these schedules belong to this operator and have active bookings
  const schedulesWithBookings = await prisma.schedule.findMany({
    where: {
      id: { in: ids },
      route: { operatorId: operator.id },
      // Outbound or return leg bookings both block a delete.
      OR: [{ bookings: { some: {} } }, { returnBookings: { some: {} } }],
    },
    include: {
      route: {
        include: {
          departurePort: { select: { name: true, timeZone: true } },
          destinationPort: { select: { name: true, timeZone: true } },
        },
      },
    },
  });

  const blockedIds = new Set(schedulesWithBookings.map(s => s.id));
  const deletableIds = ids.filter(id => !blockedIds.has(id));

  // If ALL selected schedules have bookings, reject with Conflict error
  if (deletableIds.length === 0) {
    const routeNames = schedulesWithBookings
      .map(
        s =>
          `"${s.route?.departurePort?.name ?? 'Port'} ➔ ${s.route?.destinationPort?.name ?? 'Port'}" (${formatLocalTime(s.departureTime, s.route.departurePort.timeZone)})`,
      )
      .join(', ');
    throw new ApiError(
      StatusCodes.CONFLICT,
      `Cannot delete schedule(s) [${routeNames}] because there are existing customer bookings confirmed. Please cancel the trip instead.`,
    );
  }

  try {
    const result = await prisma.schedule.deleteMany({
      where: {
        id: { in: deletableIds },
        route: { operatorId: operator.id },
      },
    });

    const skippedCount = schedulesWithBookings.length;
    const skippedDescriptions = schedulesWithBookings.map(
      s =>
        `"${s.route?.departurePort?.name ?? 'Port'} ➔ ${s.route?.destinationPort?.name ?? 'Port'}"`,
    );

    let message = `Successfully deleted ${result.count} schedules`;
    if (skippedCount > 0) {
      message = `Deleted ${result.count} schedules. ${skippedCount} ${
        skippedCount === 1 ? 'schedule was' : 'schedules were'
      } skipped because of active customer bookings.`;
    }

    return {
      count: result.count,
      deletedCount: result.count,
      skippedCount,
      skippedSchedules: skippedDescriptions,
      message,
    };
  } catch (error: any) {
    if (
      error?.code === 'P2003' ||
      error?.code === '23001' ||
      error?.message?.includes('violates RESTRICT') ||
      error?.message?.includes('foreign key constraint')
    ) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        'Cannot delete schedule(s) because active bookings or tickets are attached to them.',
      );
    }
    throw error;
  }
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const resolvePortIdentifier = async (portIdentifier: string) => {
  if (!portIdentifier) return null;
  const isUuid = UUID_REGEX.test(portIdentifier);
  const exact = await prisma.port.findFirst({
    where: {
      OR: [
        ...(isUuid ? [{ id: portIdentifier }] : []),
        { name: { equals: portIdentifier, mode: 'insensitive' } },
      ],
      isActive: true,
    },
  });
  if (exact) return exact;

  return prisma.port.findFirst({
    where: {
      name: { contains: portIdentifier, mode: 'insensitive' },
      isActive: true,
    },
  });
};

const findTripsForPortPair = async (
  departurePortId: string,
  destinationPortId: string,
  departureTimeZone: string,
  travelDate: string,
  requiredSeats: number,
  adultsCount: number,
  childrenCount: number,
  limit: number,
  tripType: TripType,
): Promise<ISearchedTripResult[]> => {
  // The searched date is a local day at the departure port, not a UTC day (spec 0003, AC-2).
  const { start: startOfDay, end: endOfDay } = localDayBounds(travelDate, departureTimeZone);
  // Never offer a sailing that has already left, even if its status was not updated.
  const now = new Date();
  const earliestDeparture = now > startOfDay ? now : startOfDay;

  const schedules = await prisma.schedule.findMany({
    where: {
      route: {
        departurePortId,
        destinationPortId,
        status: RouteStatus.ACTIVE,
      },
      departureTime: {
        gte: earliestDeparture,
        lte: endOfDay,
      },
      ferry: {
        status: VesselStatus.IN_SERVICE,
        operator: {
          user: {
            status: AccountStatus.ACTIVE,
          },
        },
      },
      status: {
        in: [TripStatus.ON_TIME, TripStatus.PREPARING, TripStatus.BOARDING],
      },
      availableSeats: {
        gte: requiredSeats,
      },
    },
    take: limit,
    orderBy: { departureTime: 'asc' },
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
  });

  return schedules.map(schedule => {
    const totalPrice =
      adultsCount * schedule.adultFare + childrenCount * schedule.childFare;
    const tripFare = getFarePerPassenger(tripType, schedule);

    return {
      tripId: schedule.id,
      operator: schedule.route.operator.companyName,
      vessel: schedule.ferry.name,
      vesselType: schedule.ferry.type,
      image:
        schedule.ferry.imageUrl ||
        getDynamicVesselImage(schedule.ferry.type, schedule.ferry.name),
      departurePort: schedule.route.departurePort?.name || '',
      departurePortId: schedule.route.departurePort?.id || departurePortId,
      destinationPort: schedule.route.destinationPort?.name || '',
      destinationPortId: schedule.route.destinationPort?.id || destinationPortId,
      // Port local clock strings: departure at its port, arrival at its port (spec 0003, AC-3).
      departureTime: formatLocalTime(schedule.departureTime, schedule.route.departurePort.timeZone),
      arrivalTime: formatLocalTime(schedule.arrivalTime, schedule.route.destinationPort.timeZone),
      duration: calculateDurationMinutes(
        schedule.departureTime,
        schedule.arrivalTime,
      ),
      availableSeats: schedule.availableSeats,
      pricePerAdult: schedule.adultFare,
      pricePerChild: schedule.childFare,
      totalPrice,
      departureAt: schedule.departureTime.toISOString(),
      arrivalAt: schedule.arrivalTime.toISOString(),
      departureTimeZone: schedule.route.departurePort.timeZone,
      arrivalTimeZone: schedule.route.destinationPort.timeZone,
      operatorId: schedule.route.operatorId,
      fareQuote: {
        tripType,
        available: tripFare !== null,
        pricePerAdult: tripFare?.adultFare ?? null,
        pricePerChild: tripFare?.childFare ?? null,
        totalPrice: tripFare
          ? Math.round(
              (adultsCount * tripFare.adultFare + childrenCount * tripFare.childFare) * 100,
            ) / 100
          : null,
      },
    };
  });
};

const searchTrips = async (
  query: ITripSearchQuery,
): Promise<ITripSearchResponse> => {
  const [departurePort, destinationPort] = await Promise.all([
    resolvePortIdentifier(query.from),
    resolvePortIdentifier(query.to),
  ]);

  const limit = query.limit ?? 10;

  if (!departurePort || !destinationPort) {
    return {
      message: 'No ferry trips found for the selected route and date.',
      pagination: {
        nextCursor: null,
        hasNextPage: false,
        limit,
      },
      outboundTrips: [],
      returnTrips: [],
    };
  }

  const totalRequiredPassengers = (query.adults ?? 1) + (query.children ?? 0);
  const tripType = SEARCH_TRIP_TYPE_TO_ENUM[query.tripType ?? 'one-way'];

  const outboundTrips = await findTripsForPortPair(
    departurePort.id,
    destinationPort.id,
    departurePort.timeZone,
    query.departureDate,
    totalRequiredPassengers,
    query.adults,
    query.children ?? 0,
    limit,
    tripType,
  );

  let returnTrips: ISearchedTripResult[] = [];

  // Same day return comes back on the departure date.
  const returnDate =
    query.tripType === 'same-day-return' ? query.departureDate : query.returnDate;

  if (query.tripType !== 'one-way' && returnDate) {
    // Return legs are priced inside the outbound bundle; their fareQuote shows one way prices.
    // The return leg leaves from the outbound destination, so its day is that port's day.
    returnTrips = await findTripsForPortPair(
      destinationPort.id,
      departurePort.id,
      destinationPort.timeZone,
      returnDate,
      totalRequiredPassengers,
      query.adults,
      query.children ?? 0,
      limit,
      TripType.ONE_WAY,
    );
  }

  const hasOutboundResults = outboundTrips.length > 0;
  const lastTripId = hasOutboundResults
    ? outboundTrips[outboundTrips.length - 1].tripId
    : null;

  return {
    ...(outboundTrips.length === 0
      ? { message: 'No ferry trips found for the selected route and date.' }
      : {}),
    pagination: {
      nextCursor: outboundTrips.length >= limit ? lastTripId : null,
      hasNextPage: outboundTrips.length >= limit,
      limit,
    },
    outboundTrips,
    returnTrips,
  };
};

const getPublicTripById = async (scheduleId: string) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
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
  });

  if (!schedule || schedule.route.status !== RouteStatus.ACTIVE) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Trip not found or unavailable');
  }

  return {
    id: schedule.id,
    tripId: schedule.id,
    operator: schedule.route.operator.companyName,
    vessel: schedule.ferry.name,
    vesselType: schedule.ferry.type,
    image:
      schedule.ferry.imageUrl ||
      getDynamicVesselImage(schedule.ferry.type, schedule.ferry.name),
    departurePort: schedule.route.departurePort.name,
    departurePortId: schedule.route.departurePort.id,
    destinationPort: schedule.route.destinationPort.name,
    destinationPortId: schedule.route.destinationPort.id,
    departureTime: schedule.departureTime,
    arrivalTime: schedule.arrivalTime,
    departureTimeZone: schedule.route.departurePort.timeZone,
    arrivalTimeZone: schedule.route.destinationPort.timeZone,
    duration: calculateDurationMinutes(schedule.departureTime, schedule.arrivalTime),
    availableSeats: schedule.availableSeats,
    adultFare: schedule.adultFare,
    childFare: schedule.childFare,
    // Per passenger fare by trip type; null = not offered on this route.
    fares: {
      ONE_WAY: getFarePerPassenger(TripType.ONE_WAY, schedule),
      ROUND_TRIP: getFarePerPassenger(TripType.ROUND_TRIP, schedule),
      SAME_DAY_RETURN: getFarePerPassenger(TripType.SAME_DAY_RETURN, schedule),
    },
    operatorId: schedule.route.operatorId,
    status: schedule.status,
    gate: schedule.gate,
    captain: schedule.captain,
  };
};

export const ScheduleService = {
  createSchedule,
  listOperatorSchedules,
  getScheduleById,
  updateSchedule,
  updateScheduleStatus,
  bulkUpdateScheduleStatus,
  deleteSchedule,
  bulkDeleteSchedules,
  searchTrips,
  getPublicTripById,
};
