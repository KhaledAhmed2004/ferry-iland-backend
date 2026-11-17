import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { AccountStatus, RouteStatus, TripStatus } from '@prisma/client';
import { USER_ROLES } from '../../../enums/user';
import {
  ICreateRouteReq,
  IListRoutesQuery,
  IPopularRoutesQuery,
  IUpdateRouteReq,
} from './route.validation';

const PORT_SELECT = {
  select: { id: true, name: true },
} as const;

/** Admin: create a platform route. Any operator can then schedule trips on it. */
const createRoute = async (dto: ICreateRouteReq) => {
  if (dto.departurePortId === dto.destinationPortId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Departure port and destination port cannot be the same',
    );
  }

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
      departurePortId_destinationPortId: {
        departurePortId: dto.departurePortId,
        destinationPortId: dto.destinationPortId,
      },
    },
  });

  if (existing) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      `A route from ${departurePort.name} to ${destinationPort.name} already exists`,
    );
  }

  return prisma.route.create({
    data: {
      departurePortId: dto.departurePortId,
      destinationPortId: dto.destinationPortId,
      durationMinutes: dto.durationMinutes,
      ...(dto.basePrice !== undefined && { basePrice: dto.basePrice }),
      description: dto.description,
      ...(dto.amenities !== undefined && { amenities: dto.amenities }),
      imageUrl: dto.imageUrl,
      isBorderCrossing: dto.isBorderCrossing ?? false,
      status: dto.status ?? RouteStatus.ACTIVE,
    },
    include: {
      departurePort: PORT_SELECT,
      destinationPort: PORT_SELECT,
    },
  });
};

/**
 * Admins see every route. Operators only need routes they can schedule on, so they
 * get active routes only, whatever status they ask for.
 */
const listRoutes = async (role: string, query: IListRoutesQuery) => {
  const isAdmin = role === USER_ROLES.ADMIN;
  const page = Number(query.page ?? 1) || 1;
  const limit = Number(query.limit ?? 10) || 10;
  const skip = (page - 1) * limit;

  const where = isAdmin
    ? query.status
      ? { status: query.status }
      : {}
    : { status: RouteStatus.ACTIVE };

  const [totalItems, routes] = await Promise.all([
    prisma.route.count({ where }),
    prisma.route.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        departurePort: PORT_SELECT,
        destinationPort: PORT_SELECT,
        // How many trips are on this route; admins see it in the routes table.
        _count: { select: { schedules: true } },
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

const updateRoute = async (id: string, dto: IUpdateRouteReq) => {
  const existing = await prisma.route.findUnique({ where: { id } });

  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, `Route not found with ID: ${id}`);
  }

  return prisma.route.update({
    where: { id },
    data: {
      ...(dto.basePrice !== undefined && { basePrice: dto.basePrice }),
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
      departurePort: PORT_SELECT,
      destinationPort: PORT_SELECT,
    },
  });
};

const deleteRoute = async (id: string) => {
  const existing = await prisma.route.findUnique({
    where: { id },
    include: {
      departurePort: { select: { name: true } },
      destinationPort: { select: { name: true } },
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
      error?.code === '23503' ||
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

const bulkUpdateRouteStatus = async (ids: string[], status: RouteStatus) => {
  const result = await prisma.route.updateMany({
    where: {
      id: { in: ids },
    },
    data: { status },
  });

  return {
    count: result.count,
    message: `Successfully updated ${result.count} routes to ${status}`,
  };
};

const bulkDeleteRoutes = async (ids: string[]) => {
  // Check which routes have schedules with existing bookings
  const routesWithBookings = await prisma.route.findMany({
    where: {
      id: { in: ids },
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
      departurePort: { select: { name: true } },
      destinationPort: { select: { name: true } },
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
      error?.code === '23503' ||
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
      departurePort: PORT_SELECT,
      destinationPort: PORT_SELECT,
    },
  });

  const portMap = new Map<
    string,
    {
      portId: string;
      portName: string;
      destinations: Map<
        string,
        {
          portId: string;
          portName: string;
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
        destinations: new Map(),
      });
    }

    const depEntry = portMap.get(dep.id)!;
    if (!depEntry.destinations.has(dest.id)) {
      depEntry.destinations.set(dest.id, {
        portId: dest.id,
        portName: dest.name,
      });
    }
  }

  return Array.from(portMap.values()).map(p => ({
    portId: p.portId,
    portName: p.portName,
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
    },
    include: {
      departurePort: PORT_SELECT,
      destinationPort: PORT_SELECT,
      // Only bookable, future departures by active operators count towards price and trip totals.
      schedules: {
        where: {
          status: { in: [TripStatus.ON_TIME, TripStatus.BOARDING, TripStatus.PREPARING] },
          departureTime: { gte: now },
          ferry: { operator: { user: { status: AccountStatus.ACTIVE } } },
        },
        select: {
          id: true,
          ferry: { select: { operator: { select: { companyName: true } } } },
          adultFare: true,
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
      // Operators with upcoming trips on this shared route; null when none.
      operatorName:
        [...new Set(route.schedules.map(s => s.ferry.operator.companyName))].join(', ') || null,
      departurePort: {
        id: route.departurePort.id,
        name: route.departurePort.name,
      },
      destinationPort: {
        id: route.destinationPort.id,
        name: route.destinationPort.name,
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
  listRoutes,
  updateRoute,
  deleteRoute,
  bulkUpdateRouteStatus,
  bulkDeleteRoutes,
  getPublicConnectedPorts,
  getPopularRoutes,
};

