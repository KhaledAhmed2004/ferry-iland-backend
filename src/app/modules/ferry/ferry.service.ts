import { StatusCodes } from 'http-status-codes';
import { VesselStatus } from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import {
  ICreateFerryPayload,
  IFerryFilterOptions,
  IUpdateFerryPayload,
} from './ferry.interface';

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

  if (operator.user && operator.user.status === 'SUSPENDED') {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Suspended operators cannot perform this operation',
    );
  }

  return operator;
};

/** Dedicated routes returned with a ferry: enough to show "From -> To". */
const dedicatedRoutesSelect = {
  select: {
    id: true,
    status: true,
    departurePort: { select: { id: true, name: true } },
    destinationPort: { select: { id: true, name: true } },
  },
} as const;

/** Routes are platform-wide; a ferry may only be dedicated to routes that exist. */
const assertRoutesExist = async (routeIds: string[]) => {
  const unique = [...new Set(routeIds)];
  if (unique.length === 0) return unique;
  const found = await prisma.route.count({ where: { id: { in: unique } } });
  if (found !== unique.length) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'One or more selected routes do not exist');
  }
  return unique;
};

const createFerry = async (userId: string, payload: ICreateFerryPayload) => {
  const operator = await resolveOperatorProfile(userId);
  const { routeIds, ...data } = payload;
  const dedicated = await assertRoutesExist(routeIds ?? []);

  return prisma.ferry.create({
    data: {
      operatorId: operator.id,
      ...data,
      amenities: data.amenities ?? [],
      dedicatedRoutes: { connect: dedicated.map(id => ({ id })) },
    },
    include: { dedicatedRoutes: dedicatedRoutesSelect },
  });
};

const listOperatorFerries = async (
  userId: string,
  options: IFerryFilterOptions,
) => {
  const operator = await resolveOperatorProfile(userId);

  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const skip = (page - 1) * limit;

  const whereClause: Record<string, any> = {
    operatorId: operator.id,
  };

  if (options.status) {
    whereClause.status = options.status;
  }

  if (options.type) {
    whereClause.type = options.type;
  }

  if (options.search) {
    whereClause.name = { contains: options.search, mode: 'insensitive' };
  }

  // Ferries allowed on a route: dedicated to it, or free to sail any route.
  if (options.routeId) {
    whereClause.OR = [
      { dedicatedRoutes: { none: {} } },
      { dedicatedRoutes: { some: { id: options.routeId } } },
    ];
  }

  const [ferries, totalCount] = await Promise.all([
    prisma.ferry.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        dedicatedRoutes: dedicatedRoutesSelect,
        _count: {
          select: {
            schedules: true,
          },
        },
      },
    }),
    prisma.ferry.count({ where: whereClause }),
  ]);

  const items = ferries.map(ferry => {
    const { _count, ...rest } = ferry as any;
    return {
      ...rest,
      scheduleCount: _count?.schedules ?? 0,
    };
  });

  const totalPages = Math.ceil(totalCount / limit);

  return {
    items,
    meta: {
      page,
      limit,
      total: totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1 && totalPages > 0,
    },
  };
};

const getFerryById = async (userId: string, ferryId: string) => {
  const operator = await resolveOperatorProfile(userId);

  const ferry = await prisma.ferry.findUnique({
    where: { id: ferryId },
    include: {
      dedicatedRoutes: dedicatedRoutesSelect,
      _count: {
        select: {
          schedules: true,
        },
      },
    },
  });

  if (!ferry || ferry.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Ferry vessel not found');
  }

  const { _count, ...ferryData } = ferry as any;
  return {
    ...ferryData,
    scheduleCount: _count?.schedules ?? 0,
  };
};

const updateFerry = async (
  userId: string,
  ferryId: string,
  payload: IUpdateFerryPayload,
) => {
  const operator = await resolveOperatorProfile(userId);

  const existingFerry = await prisma.ferry.findUnique({
    where: { id: ferryId },
  });

  if (!existingFerry || existingFerry.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Ferry vessel not found');
  }

  const { routeIds, ...data } = payload;
  // Omitted = keep the current routes; [] = clear them (ferry may sail any route).
  const dedicated = routeIds === undefined ? undefined : await assertRoutesExist(routeIds);

  return prisma.ferry.update({
    where: { id: ferryId },
    data: {
      ...data,
      ...(dedicated ? { dedicatedRoutes: { set: dedicated.map(id => ({ id })) } } : {}),
    },
    include: { dedicatedRoutes: dedicatedRoutesSelect },
  });
};

const deleteFerry = async (userId: string, ferryId: string) => {
  const operator = await resolveOperatorProfile(userId);

  const existingFerry = await prisma.ferry.findUnique({
    where: { id: ferryId },
    include: {
      _count: {
        select: {
          schedules: true,
        },
      },
    },
  });

  if (!existingFerry || existingFerry.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Ferry vessel not found');
  }

  // Trips (and their bookings/tickets) point at this ferry, so it cannot be removed.
  if (existingFerry._count.schedules > 0) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "This ferry has trips, so it can't be deleted. Set it to Maintenance instead.",
    );
  }

  await prisma.ferry.delete({
    where: { id: ferryId },
  });

  return {
    message: 'Vessel permanently deleted',
    ferry: null,
  };
};

const getFerryStats = async (userId: string) => {
  const operator = await resolveOperatorProfile(userId);

  const ferries = await prisma.ferry.findMany({
    where: { operatorId: operator.id },
    select: {
      status: true,
      capacity: true,
    },
  });

  const totalFerries = ferries.length;
  const inServiceFerries = ferries.filter(
    f => f.status === VesselStatus.IN_SERVICE,
  ).length;
  const maintenanceFerries = ferries.filter(
    f => f.status === VesselStatus.MAINTENANCE,
  ).length;
  const totalCapacity = ferries.reduce((acc, f) => acc + (f.capacity || 0), 0);

  return {
    totalFerries,
    inServiceFerries,
    maintenanceFerries,
    totalCapacity,
  };
};

export const FerryService = {
  createFerry,
  listOperatorFerries,
  getFerryById,
  getFerryStats,
  updateFerry,
  deleteFerry,
};
