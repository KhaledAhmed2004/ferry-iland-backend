import { AccountStatus, Prisma, TripStatus } from '@prisma/client';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { logger } from '../../../shared/logger';
import { deleteFile } from '../../middlewares/fileHandler';
import { SessionService, RevocationReason } from '../session/session.service';
import { ProviderEmails } from './provider.email';
import {
  IOperatorSettingsUpdatePayload,
  IProviderFilterRequest,
  IProviderStatusUpdatePayload,
  ProviderSortField,
} from './provider.interface';

const buildProviderOrderBy = (
  sortBy: ProviderSortField = 'createdAt',
  sortOrder: 'asc' | 'desc' = 'desc',
): Prisma.OperatorProfileOrderByWithRelationInput[] => {
  const primary: Record<
    ProviderSortField,
    Prisma.OperatorProfileOrderByWithRelationInput
  > = {
    createdAt: { createdAt: sortOrder },
    companyName: { companyName: sortOrder },
    contactPersonName: { contactPersonName: sortOrder },
    status: { user: { status: sortOrder } },
    ferriesCount: { ferries: { _count: sortOrder } },
  };
  // Tie-breakers keep page boundaries stable when sort values repeat.
  return [primary[sortBy], { createdAt: 'desc' }, { id: 'asc' }];
};

const listProviders = async (filters: IProviderFilterRequest) => {
  const page = Number(filters.page || 1);
  const limit = Number(filters.limit || 10);
  const skip = (page - 1) * limit;

  const whereConditions: Prisma.OperatorProfileWhereInput = {};

  if (filters.status) {
    whereConditions.user = {
      status: filters.status,
    };
  }

  if (filters.searchTerm) {
    whereConditions.OR = [
      { companyName: { contains: filters.searchTerm, mode: 'insensitive' } },
      {
        contactPersonName: {
          contains: filters.searchTerm,
          mode: 'insensitive',
        },
      },
      {
        user: { email: { contains: filters.searchTerm, mode: 'insensitive' } },
      },
    ];
  }

  const [total, providers] = await Promise.all([
    prisma.operatorProfile.count({ where: whereConditions }),
    prisma.operatorProfile.findMany({
      where: whereConditions,
      skip,
      take: limit,
      orderBy: buildProviderOrderBy(filters.sortBy, filters.sortOrder),
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
          },
        },
        _count: {
          select: {
            ferries: true,
          },
        },
      },
    }),
  ]);

  const routesRun = await countRoutesRunByOperators(providers.map(p => p.id));

  const formattedProviders = providers.map(p => ({
    id: p.id,
    userId: p.userId,
    companyName: p.companyName,
    contactPersonName: p.contactPersonName,
    contactEmail: p.contactEmail,
    businessAddress: p.businessAddress,
    logoUrl: p.logoUrl,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    user: p.user,
    ferriesCount: p._count.ferries,
    routesCount: routesRun.get(p.id) ?? 0,
  }));

  const totalPages = Math.ceil(total / limit);

  return {
    meta: {
      page,
      limit,
      total,
      totalPages,
    },
    data: formattedProviders,
  };
};

const getProviderById = async (providerId: string) => {
  const provider = await prisma.operatorProfile.findUnique({
    where: { id: providerId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          phoneNumber: true,
          status: true,
          isEmailVerified: true,
          createdAt: true,
        },
      },
      ferries: {
        orderBy: { createdAt: 'desc' },
      },
      _count: {
        select: {
          ferries: true,
          offDays: true,
        },
      },
    },
  });

  if (!provider) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Ferry provider profile not found',
    );
  }

  // Routes are shared; list the ones this operator runs trips on (any of its ferries).
  const routes = await prisma.route.findMany({
    where: { schedules: { some: { ferry: { operatorId: providerId } } } },
    include: { departurePort: true, destinationPort: true },
    orderBy: { createdAt: 'desc' },
  });

  return {
    ...provider,
    routes,
    _count: { ...provider._count, routes: routes.length },
  };
};

/**
 * Number of distinct (shared) routes each operator runs trips on.
 * Operators no longer own routes, so this replaces the old per-operator route count.
 */
const countRoutesRunByOperators = async (operatorIds: string[]) => {
  const counts = new Map<string, number>();
  if (operatorIds.length === 0) return counts;

  const pairs = await prisma.schedule.findMany({
    where: { ferry: { operatorId: { in: operatorIds } } },
    distinct: ['routeId', 'ferryId'],
    select: { routeId: true, ferry: { select: { operatorId: true } } },
  });

  const routesByOperator = new Map<string, Set<string>>();
  for (const { routeId, ferry } of pairs) {
    const set = routesByOperator.get(ferry.operatorId) ?? new Set<string>();
    set.add(routeId);
    routesByOperator.set(ferry.operatorId, set);
  }
  for (const [operatorId, set] of routesByOperator) counts.set(operatorId, set.size);
  return counts;
};

const updateProviderStatus = async (
  providerId: string,
  payload: IProviderStatusUpdatePayload,
) => {
  const provider = await prisma.operatorProfile.findUnique({
    where: { id: providerId },
    include: { user: true },
  });

  if (!provider) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Ferry provider profile not found',
    );
  }

  const result = await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: provider.userId },
      data: { status: payload.status },
    });

    let deactivatedTripsCount = 0;

    if (payload.status === AccountStatus.SUSPENDED) {
      const now = new Date();

      // Log the operator out everywhere (same as UserService.updateUserStatus),
      // so open dashboards get a 401 and are sent back to login.
      await SessionService.revokeAllUserSessions(
        provider.userId,
        RevocationReason.USER_REVOKED,
        tx,
      );
      const unbookedUpcomingSchedules = await tx.schedule.findMany({
        where: {
          ferry: { operatorId: providerId },
          departureTime: { gt: now },
          bookings: { none: {} },
          // A schedule booked as someone's return leg is booked too.
          returnBookings: { none: {} },
          status: { not: TripStatus.CANCELLED },
        },
        select: { id: true },
      });

      const scheduleIdsToDeactivate = unbookedUpcomingSchedules.map(
        schedule => schedule.id,
      );

      if (scheduleIdsToDeactivate.length > 0) {
        const updateResult = await tx.schedule.updateMany({
          where: { id: { in: scheduleIdsToDeactivate } },
          data: { status: TripStatus.CANCELLED },
        });
        deactivatedTripsCount = updateResult.count;
      }
    }

    const updatedProvider = await tx.operatorProfile.findUnique({
      where: { id: providerId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
          },
        },
      },
    });

    return {
      provider: updatedProvider,
      deactivatedTripsCount,
    };
  });

  // Tell the operator what happened, after the change has committed. A suspended
  // operator is already signed out by now, so email is the only way to reach them.
  // These never throw: a mail problem must not undo the status change.
  if (payload.status === AccountStatus.SUSPENDED) {
    void ProviderEmails.sendOperatorSuspended(providerId, result.deactivatedTripsCount);
  } else if (payload.status === AccountStatus.ACTIVE) {
    void ProviderEmails.sendOperatorReactivated(providerId);
  }

  return result;
};

const getOperatorSettings = async (userId: string) => {
  const operatorProfile = await prisma.operatorProfile.findUnique({
    where: { userId },
    include: {
      user: {
        select: {
          email: true,
          name: true,
          phoneNumber: true,
          status: true,
        },
      },
    },
  });

  if (!operatorProfile) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Operator company profile not found for authenticated user',
    );
  }

  return operatorProfile;
};

const updateOperatorSettings = async (
  userId: string,
  payload: IOperatorSettingsUpdatePayload,
) => {
  const existingProfile = await prisma.operatorProfile.findUnique({
    where: { userId },
  });

  if (!existingProfile) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Operator company profile not found for authenticated user',
    );
  }

  if (payload.logo && !isImageUploadUrl(payload.logo)) {
    await removeStoredLogo(payload.logo);
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Logo must be a PNG, JPG or WebP image',
    );
  }

  // A new upload replaces the logo; removeLogo clears it. Otherwise it stays as is.
  const nextLogoUrl = payload.logo ?? (payload.removeLogo ? null : undefined);

  const updatedProfile = await prisma.operatorProfile.update({
    where: { userId },
    data: {
      companyName: payload.companyName,
      contactPersonName: payload.contactPersonName,
      contactEmail: payload.contactEmail,
      businessAddress: payload.businessAddress,
      logoUrl: nextLogoUrl,
    },
    include: {
      user: {
        select: {
          email: true,
          name: true,
          phoneNumber: true,
          status: true,
        },
      },
    },
  });

  // The old file is only removed once the new value is saved.
  if (
    nextLogoUrl !== undefined &&
    existingProfile.logoUrl &&
    existingProfile.logoUrl !== nextLogoUrl
  ) {
    await removeStoredLogo(existingProfile.logoUrl);
  }

  return updatedProfile;
};

/** fileHandler stores images under an `images/` key; anything else (PDF, video) is not a logo. */
const isImageUploadUrl = (url: string) => url.includes('/images/');

/** Best-effort delete of a stored logo; a missing file must not fail the request. */
const removeStoredLogo = async (url: string) => {
  try {
    await deleteFile(url, {
      provider: url.includes('/uploads/') ? 'local' : undefined,
    });
  } catch (error) {
    logger.warn(
      `Could not delete old operator logo ${url}: ${(error as Error).message}`,
    );
  }
};

export const ProviderService = {
  listProviders,
  getProviderById,
  updateProviderStatus,
  getOperatorSettings,
  updateOperatorSettings,
};
