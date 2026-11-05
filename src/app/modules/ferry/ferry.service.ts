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

const createFerry = async (userId: string, payload: ICreateFerryPayload) => {
  const operator = await resolveOperatorProfile(userId);

  return prisma.ferry.create({
    data: {
      operatorId: operator.id,
      ...payload,
      amenities: payload.amenities ?? [],
    },
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
    whereClause.OR = [
      { name: { contains: options.search, mode: 'insensitive' } },
    ];
  }

  const [ferries, totalCount] = await Promise.all([
    prisma.ferry.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
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

  return prisma.ferry.update({
    where: { id: ferryId },
    data: payload,
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

  if (existingFerry._count.schedules > 0) {
    const decommissionedFerry = await prisma.ferry.update({
      where: { id: ferryId },
      data: { status: VesselStatus.OUT_OF_SERVICE },
    });

    return {
      decommissioned: true,
      message:
        'Vessel has linked schedules and has been set to OUT_OF_SERVICE instead of deleted',
      ferry: decommissionedFerry,
    };
  }

  await prisma.ferry.delete({
    where: { id: ferryId },
  });

  return {
    decommissioned: false,
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
  const outOfServiceFerries = ferries.filter(
    f => f.status === VesselStatus.OUT_OF_SERVICE,
  ).length;
  const totalCapacity = ferries.reduce((acc, f) => acc + (f.capacity || 0), 0);

  return {
    totalFerries,
    inServiceFerries,
    maintenanceFerries,
    outOfServiceFerries,
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
