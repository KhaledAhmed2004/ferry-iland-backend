import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { TripStatus } from '@prisma/client';
import { assertValidTimeZone } from '../../../shared/portTime';
import {
  ICreatePortPayload,
  IPortFilterOptions,
  IUpdatePortPayload,
} from './port.interface';

const createPort = async (payload: ICreatePortPayload) => {
  return prisma.port.create({
    data: {
      name: payload.name,
      timeZone: assertValidTimeZone(payload.timeZone),
      isActive: payload.isActive ?? true,
    },
  });
};

const listPorts = async (options: IPortFilterOptions) => {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const skip = (page - 1) * limit;

  const whereClause: Record<string, any> = {};

  if (typeof options.isActive === 'boolean') {
    whereClause.isActive = options.isActive;
  }

  if (options.search) {
    whereClause.name = { contains: options.search, mode: 'insensitive' };
  }

  const [ports, totalPortsCount] = await Promise.all([
    prisma.port.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
    }),
    prisma.port.count({ where: whereClause }),
  ]);

  return {
    meta: {
      page,
      limit,
      total: totalPortsCount,
      totalPages: Math.ceil(totalPortsCount / limit),
    },
    data: ports,
  };
};

const getPortById = async (portId: string) => {
  const port = await prisma.port.findUnique({
    where: { id: portId },
  });

  if (!port) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Port not found');
  }

  return port;
};

const updatePort = async (portId: string, payload: IUpdatePortPayload) => {
  const existingPort = await prisma.port.findUnique({
    where: { id: portId },
  });

  if (!existingPort) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Port not found');
  }

  const changesTimeZone =
    payload.timeZone !== undefined && payload.timeZone !== existingPort.timeZone;
  if (!changesTimeZone) {
    return prisma.port.update({ where: { id: portId }, data: payload });
  }

  const timeZone = assertValidTimeZone(payload.timeZone);

  // A zone change would silently move every booked sailing, so it is blocked while any
  // future, non cancelled trip leaves from or arrives at this port (spec 0003, AC-11).
  return prisma.$transaction(async tx => {
    const upcomingTrips = await tx.schedule.count({
      where: {
        departureTime: { gt: new Date() },
        status: { not: TripStatus.CANCELLED },
        route: {
          OR: [{ departurePortId: portId }, { destinationPortId: portId }],
        },
      },
    });

    if (upcomingTrips > 0) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        `Cannot change time zone: ${upcomingTrips} upcoming trip${upcomingTrips === 1 ? '' : 's'} depart from or arrive at this port`,
        '',
        { field: 'timeZone', upcomingTrips },
      );
    }

    return tx.port.update({ where: { id: portId }, data: { ...payload, timeZone } });
  });
};

const deletePort = async (portId: string) => {
  const existingPort = await prisma.port.findUnique({
    where: { id: portId },
    include: {
      _count: {
        select: {
          departureRoutes: true,
          destinationRoutes: true,
        },
      },
    },
  });

  if (!existingPort) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Port not found');
  }

  const totalConnectedRoutes =
    existingPort._count.departureRoutes + existingPort._count.destinationRoutes;

  if (totalConnectedRoutes > 0) {
    const deactivatedPort = await prisma.port.update({
      where: { id: portId },
      data: { isActive: false },
    });

    return {
      deactivated: true,
      message:
        'Port is referenced by existing routes and has been deactivated instead of deleted',
      port: deactivatedPort,
    };
  }

  await prisma.port.delete({
    where: { id: portId },
  });

  return {
    deactivated: false,
    message: 'Port permanently deleted',
    port: null,
  };
};

export const PortService = {
  createPort,
  listPorts,
  getPortById,
  updatePort,
  deletePort,
};
