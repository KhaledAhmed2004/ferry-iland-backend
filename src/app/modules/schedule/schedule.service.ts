import { StatusCodes } from 'http-status-codes';
import {
  AccountStatus,
  Prisma,
  RouteStatus,
  TripStatus,
  VesselStatus,
} from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { getDynamicVesselImage } from '../../../shared/mediaCatalog';
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

const startOfUtcDay = (date: Date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

const assertNotBlackout = async (
  db: Db,
  operatorId: string,
  ferryId: string,
  departure: Date,
) => {
  const activeOffDay = await db.offDay.findFirst({
    where: {
      operatorId,
      date: startOfUtcDay(departure),
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

const formatTimeOfDay = (date: Date): string => {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
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

const createSchedule = async (
  userId: string,
  payload: ICreateSchedulePayload,
) => {
  const operator = await resolveOperatorProfile(userId);

  const departureTimeDate = new Date(payload.departureTime);
  const arrivalTimeDate = new Date(payload.arrivalTime);

  const [route, ferry] = await Promise.all([
    prisma.route.findUnique({
      where: { id: payload.routeId },
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

  assertWithinCapacity(payload.availableSeats, ferry.capacity);
  const assignedCapacity = payload.availableSeats ?? ferry.capacity;

  return withVesselLock(ferry.id, async tx => {
    await assertNotBlackout(tx, operator.id, ferry.id, departureTimeDate);
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
    const startOfDay = new Date(`${options.date}T00:00:00.000Z`);
    const endOfDay = new Date(`${options.date}T23:59:59.999Z`);
    whereClause.departureTime = {
      gte: startOfDay,
      lte: endOfDay,
    };
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
    include: { route: true, ferry: true },
  });

  if (!existingSchedule || existingSchedule.route.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Schedule slot not found');
  }

  assertWithinCapacity(payload.availableSeats, existingSchedule.ferry.capacity);

  const newDeparture = payload.departureTime
    ? new Date(payload.departureTime)
    : existingSchedule.departureTime;
  const newArrival = payload.arrivalTime
    ? new Date(payload.arrivalTime)
    : existingSchedule.arrivalTime;

  return withVesselLock(existingSchedule.ferryId, async tx => {
    if (payload.departureTime || payload.arrivalTime) {
      await assertNotBlackout(
        tx,
        operator.id,
        existingSchedule.ferryId,
        newDeparture,
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
          departurePort: { select: { name: true } },
          destinationPort: { select: { name: true } },
        },
      },
      _count: {
        select: { bookings: true },
      },
    },
  });

  if (!existingSchedule || existingSchedule.route.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Schedule slot not found');
  }

  if (existingSchedule._count.bookings > 0) {
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
      bookings: {
        some: {},
      },
    },
    include: {
      route: {
        include: {
          departurePort: { select: { name: true } },
          destinationPort: { select: { name: true } },
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
          `"${s.route?.departurePort?.name ?? 'Port'} ➔ ${s.route?.destinationPort?.name ?? 'Port'}" (${new Date(s.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
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
  travelDate: string,
  requiredSeats: number,
  adultsCount: number,
  childrenCount: number,
  limit: number,
): Promise<ISearchedTripResult[]> => {
  const startOfDay = new Date(`${travelDate}T00:00:00.000Z`);
  const endOfDay = new Date(`${travelDate}T23:59:59.999Z`);

  const schedules = await prisma.schedule.findMany({
    where: {
      route: {
        departurePortId,
        destinationPortId,
        status: RouteStatus.ACTIVE,
      },
      departureTime: {
        gte: startOfDay,
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
      departureTime: formatTimeOfDay(schedule.departureTime),
      arrivalTime: formatTimeOfDay(schedule.arrivalTime),
      duration: calculateDurationMinutes(
        schedule.departureTime,
        schedule.arrivalTime,
      ),
      availableSeats: schedule.availableSeats,
      pricePerAdult: schedule.adultFare,
      pricePerChild: schedule.childFare,
      totalPrice,
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

  const outboundTrips = await findTripsForPortPair(
    departurePort.id,
    destinationPort.id,
    query.departureDate,
    totalRequiredPassengers,
    query.adults,
    query.children ?? 0,
    limit,
  );

  let returnTrips: ISearchedTripResult[] = [];

  if (query.tripType === 'round-trip' && query.returnDate) {
    returnTrips = await findTripsForPortPair(
      destinationPort.id,
      departurePort.id,
      query.returnDate,
      totalRequiredPassengers,
      query.adults,
      query.children ?? 0,
      limit,
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
    duration: calculateDurationMinutes(schedule.departureTime, schedule.arrivalTime),
    availableSeats: schedule.availableSeats,
    adultFare: schedule.adultFare,
    childFare: schedule.childFare,
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
