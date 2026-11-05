import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { AccountStatus, RouteStatus, TripStatus } from '@prisma/client';
import {
  ICreateRouteReq,
  IListRoutesQuery,
  IPopularRoutesQuery,
  IUpdateRouteReq,
} from './route.validation';

const getOperatorProfile = async (userId: string) => {
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

type IBundleFares = {
  adultRoundTripFare?: number | null;
  childRoundTripFare?: number | null;
  adultSameDayFare?: number | null;
  childSameDayFare?: number | null;
};

/** Only the bundle fares the request sent; null clears one (option not offered). */
const pickBundleFares = (dto: IBundleFares): IBundleFares => {
  const fares: IBundleFares = {};
  for (const key of [
    'adultRoundTripFare',
    'childRoundTripFare',
    'adultSameDayFare',
    'childSameDayFare',
  ] as const) {
    if (dto[key] !== undefined) fares[key] = dto[key];
  }
  return fares;
};

const createRoute = async (userId: string, dto: ICreateRouteReq) => {
  if (dto.departurePortId === dto.destinationPortId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Departure port and destination port cannot be the same',
    );
  }

  const operator = await getOperatorProfile(userId);

  const [departurePort, destinationPort] = await Promise.all([
    prisma.port.findUnique({ where: { id: dto.departurePortId } }),
    prisma.port.findUnique({ where: { id: dto.destinationPortId } }),
  ]);

  if (!departurePort || !departurePort.isActive) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      `Departure port not found or inactive: ${dto.departurePortId}`,
    );
  }

  if (!destinationPort || !destinationPort.isActive) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      `Destination port not found or inactive: ${dto.destinationPortId}`,
    );
  }

  const existing = await prisma.route.findUnique({
    where: {
      operatorId_departurePortId_destinationPortId: {
        operatorId: operator.id,
        departurePortId: dto.departurePortId,
        destinationPortId: dto.destinationPortId,
      },
    },
  });

  if (existing) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'You already have an active route configured between these ports',
    );
  }

  return prisma.route.create({
    data: {
      operatorId: operator.id,
      departurePortId: dto.departurePortId,
      destinationPortId: dto.destinationPortId,
      durationMinutes: dto.durationMinutes,
      ...(dto.basePrice !== undefined && { basePrice: dto.basePrice }),
      ...pickBundleFares(dto),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.amenities !== undefined && { amenities: dto.amenities }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
      isBorderCrossing: dto.isBorderCrossing ?? false,
      status: dto.status ?? RouteStatus.ACTIVE,
    },
    include: {
      departurePort: {
        select: {
          id: true,
          name: true,
          timeZone: true,
        },
      },
      destinationPort: {
        select: {
          id: true,
          name: true,
          timeZone: true,
        },
      },
    },
  });
};

const listOperatorRoutes = async (userId: string, query: IListRoutesQuery) => {
  const operator = await getOperatorProfile(userId);

  const page = Number(query.page ?? 1) || 1;
  const limit = Number(query.limit ?? 10) || 10;
  const skip = (page - 1) * limit;

  const where = {
    operatorId: operator.id,
    ...(query.status ? { status: query.status } : {}),
  };

  const [totalItems, routes] = await Promise.all([
    prisma.route.count({ where }),
    prisma.route.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        departurePort: {
          select: {
            id: true,
            name: true,
            timeZone: true,
          },
        },
        destinationPort: {
          select: {
            id: true,
            name: true,
            timeZone: true,
          },
        },
      },
    }),
  ]);

  const totalPages = Math.ceil(totalItems / limit) || 1;

  return {
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
    },
    routes,
  };
};

const getRouteById = async (userId: string, id: string) => {
  const operator = await getOperatorProfile(userId);

  const route = await prisma.route.findFirst({
    where: {
      id,
      operatorId: operator.id,
    },
    include: {
      departurePort: {
        select: {
          id: true,
          name: true,
          timeZone: true,
        },
      },
      destinationPort: {
        select: {
          id: true,
          name: true,
          timeZone: true,
        },
      },
    },
  });

  if (!route) {
    throw new ApiError(StatusCodes.NOT_FOUND, `Route not found with ID: ${id}`);
  }

  return route;
};

const updateRoute = async (
  userId: string,
  id: string,
  dto: IUpdateRouteReq,
) => {
  const operator = await getOperatorProfile(userId);

  const existing = await prisma.route.findFirst({
    where: {
      id,
      operatorId: operator.id,
    },
  });

  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, `Route not found with ID: ${id}`);
  }

  return prisma.route.update({
    where: { id },
    data: {
      ...(dto.basePrice !== undefined && { basePrice: dto.basePrice }),
      ...pickBundleFares(dto),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.amenities !== undefined && { amenities: dto.amenities }),
      ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
      ...(dto.durationMinutes !== undefined && {
        durationMinutes: dto.durationMinutes,
      }),
      ...(dto.isBorderCrossing !== undefined && {
        isBorderCrossing: dto.isBorderCrossing,
      }),
      ...(dto.status !== undefined && {
        status: dto.status,
      }),
    },
    include: {
      departurePort: {
        select: {
          id: true,
          name: true,
          timeZone: true,
        },
      },
      destinationPort: {
        select: {
          id: true,
          name: true,
          timeZone: true,
        },
      },
    },
  });
};

const deleteRoute = async (userId: string, id: string) => {
  const operator = await getOperatorProfile(userId);

  const existing = await prisma.route.findFirst({
    where: {
      id,
      operatorId: operator.id,
    },
    include: {
      departurePort: { select: { name: true, timeZone: true } },
      destinationPort: { select: { name: true, timeZone: true } },
      schedules: {
        where: {
          bookings: {
            some: {},
          },
        },
        select: {
          id: true,
        },
      },
    },
  });

  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, `Route not found with ID: ${id}`);
  }

  if (existing.schedules && existing.schedules.length > 0) {
    const routeName = existing.departurePort?.name && existing.destinationPort?.name
      ? `${existing.departurePort.name} ➔ ${existing.destinationPort.name}`
      : id;
    throw new ApiError(
      StatusCodes.CONFLICT,
      `Cannot delete route "${routeName}" because it has existing passenger bookings on scheduled trips. Please deactivate (pause) the route instead.`,
    );
  }

  try {
    await prisma.route.delete({
      where: { id },
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
        'Cannot delete route because there are active passenger bookings referencing scheduled trips on this route. Please deactivate the route instead.',
      );
    }
    throw error;
  }

  return {
    success: true,
    message: 'Route deleted successfully',
  };
};

const bulkUpdateRouteStatus = async (
  userId: string,
  ids: string[],
  status: RouteStatus,
) => {
  const operator = await getOperatorProfile(userId);

  const result = await prisma.route.updateMany({
    where: {
      id: { in: ids },
      operatorId: operator.id,
    },
    data: { status },
  });

  return {
    count: result.count,
    message: `Successfully updated ${result.count} routes to ${status}`,
  };
};

const bulkDeleteRoutes = async (userId: string, ids: string[]) => {
  const operator = await getOperatorProfile(userId);

  // Check which routes have schedules with existing bookings
  const routesWithBookings = await prisma.route.findMany({
    where: {
      id: { in: ids },
      operatorId: operator.id,
      schedules: {
        some: {
          bookings: {
            some: {},
          },
        },
      },
    },
    select: {
      id: true,
      departurePort: { select: { name: true, timeZone: true } },
      destinationPort: { select: { name: true, timeZone: true } },
    },
  });

  const blockedIds = new Set(routesWithBookings.map(r => r.id));
  const deletableIds = ids.filter(id => !blockedIds.has(id));

  // If ALL selected routes have active bookings, reject with Conflict error
  if (deletableIds.length === 0) {
    const names = routesWithBookings
      .map(
        r =>
          `"${r.departurePort?.name ?? 'Port'} ➔ ${r.destinationPort?.name ?? 'Port'}"`,
      )
      .join(', ');
    throw new ApiError(
      StatusCodes.CONFLICT,
      `Cannot delete route(s) [${names}] because there are existing passenger bookings attached. Please deactivate (pause) them instead.`,
    );
  }

  try {
    const result = await prisma.route.deleteMany({
      where: {
        id: { in: deletableIds },
        operatorId: operator.id,
      },
    });

    const skippedCount = routesWithBookings.length;
    const skippedNames = routesWithBookings.map(
      r =>
        `"${r.departurePort?.name ?? 'Port'} ➔ ${r.destinationPort?.name ?? 'Port'}"`,
    );

    let message = `Successfully deleted ${result.count} routes`;
    if (skippedCount > 0) {
      message = `Deleted ${result.count} routes. ${skippedCount} ${
        skippedCount === 1 ? 'route' : 'routes'
      } (${skippedNames.join(
        ', ',
      )}) skipped because of active passenger bookings.`;
    }

    return {
      count: result.count,
      deletedCount: result.count,
      skippedCount,
      skippedRoutes: skippedNames,
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
        'Cannot delete route(s) because there are active passenger bookings referencing scheduled trips on these routes. Please deactivate the routes instead.',
      );
    }
    throw error;
  }
};

const getPublicConnectedPorts = async () => {
  const activeRoutes = await prisma.route.findMany({
    where: {
      status: RouteStatus.ACTIVE,
      departurePort: { isActive: true },
      destinationPort: { isActive: true },
    },
    select: {
      departurePort: {
        select: {
          id: true,
          name: true,
          timeZone: true,
        },
      },
      destinationPort: {
        select: {
          id: true,
          name: true,
          timeZone: true,
        },
      },
    },
  });

  const portMap = new Map<
    string,
    {
      portId: string;
      portName: string;
      timeZone: string;
      destinations: Map<
        string,
        {
          portId: string;
          portName: string;
          timeZone: string;
        }
      >;
    }
  >();

  for (const route of activeRoutes) {
    const dep = route.departurePort;
    const dest = route.destinationPort;

    if (!portMap.has(dep.id)) {
      portMap.set(dep.id, {
        portId: dep.id,
        portName: dep.name,
        timeZone: dep.timeZone,
        destinations: new Map(),
      });
    }

    const depEntry = portMap.get(dep.id)!;
    if (!depEntry.destinations.has(dest.id)) {
      depEntry.destinations.set(dest.id, {
        portId: dest.id,
        portName: dest.name,
        timeZone: dest.timeZone,
      });
    }
  }

  return Array.from(portMap.values()).map(p => ({
    portId: p.portId,
    portName: p.portName,
    timeZone: p.timeZone,
    destinations: Array.from(p.destinations.values()),
  }));
};

const getPopularRoutes = async (query?: IPopularRoutesQuery) => {
  const limit = query?.limit ?? 4;
  const now = new Date();

  const activeRoutes = await prisma.route.findMany({
    where: {
      status: RouteStatus.ACTIVE,
      departurePort: { isActive: true },
      destinationPort: { isActive: true },
      operator: {
        user: {
          status: AccountStatus.ACTIVE,
        },
      },
    },
    include: {
      departurePort: true,
      destinationPort: true,
      operator: {
        select: {
          id: true,
          companyName: true,
          contactEmail: true,
        },
      },
      // Only bookable, future departures count towards price and trip totals.
      schedules: {
        where: {
          status: { in: [TripStatus.ON_TIME, TripStatus.BOARDING, TripStatus.PREPARING] },
          departureTime: { gte: now },
        },
        select: {
          id: true,
          adultFare: true,
          childFare: true,
          availableSeats: true,
          departureTime: true,
          _count: {
            select: {
              bookings: true,
            },
          },
        },
      },
    },
  });

  const mapped = activeRoutes.map(route => {
    const adultFares = route.schedules
      .map(s => s.adultFare)
      .filter(f => typeof f === 'number' && f > 0);
    // Real fare only: cheapest upcoming adult fare, else the route's base price, else unknown.
    const startingPrice =
      adultFares.length > 0
        ? Math.min(...adultFares)
        : typeof route.basePrice === 'number' && route.basePrice > 0
          ? route.basePrice
          : null;

    const totalBookings = route.schedules.reduce(
      (sum, s) => sum + (s._count?.bookings ?? 0),
      0,
    );
    const upcomingTripsCount = route.schedules.length;

    // Earliest future departure that still has a free seat; null when none is bookable.
    const nextDeparture = route.schedules
      .filter(s => s.availableSeats > 0)
      .reduce<Date | null>(
        (earliest, s) => (!earliest || s.departureTime < earliest ? s.departureTime : earliest),
        null,
      );

    const popularityScore = totalBookings * 10 + upcomingTripsCount;

    return {
      id: route.id,
      routeId: route.id,
      from: route.departurePort.name,
      fromPortId: route.departurePort.id,
      to: route.destinationPort.name,
      toPortId: route.destinationPort.id,
      durationMinutes: route.durationMinutes,
      startingPrice,
      upcomingTripsCount,
      nextDepartureTime: nextDeparture ? nextDeparture.toISOString() : null,
      totalBookings,
      popularityScore,
      highlights: Array.isArray(route.amenities) ? route.amenities : [],
      description: route.description || null,
      imageUrl: route.imageUrl || null,
      operatorName: route.operator.companyName,
      departurePort: {
        id: route.departurePort.id,
        name: route.departurePort.name,
        timeZone: route.departurePort.timeZone,
      },
      destinationPort: {
        id: route.destinationPort.id,
        name: route.destinationPort.name,
        timeZone: route.destinationPort.timeZone,
      },
    };
  });

  mapped.sort((a, b) => b.popularityScore - a.popularityScore);

  return mapped.slice(0, limit).map((route, index) => ({
    ...route,
    tag: index === 0 && route.totalBookings > 0 ? 'Most Popular' : null,
  }));
};

export const RouteService = {
  createRoute,
  listOperatorRoutes,
  getRouteById,
  updateRoute,
  deleteRoute,
  bulkUpdateRouteStatus,
  bulkDeleteRoutes,
  getPublicConnectedPorts,
  getPopularRoutes,
};

