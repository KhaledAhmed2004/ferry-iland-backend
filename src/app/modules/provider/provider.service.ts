import { AccountStatus, Prisma, TripStatus } from '@prisma/client';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { RevocationReason } from '../session/session.service';
import {
  IOperatorSettingsUpdatePayload,
  IProviderFilterRequest,
  IProviderStatusUpdatePayload,
} from './provider.interface';

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
      { contactPersonName: { contains: filters.searchTerm, mode: 'insensitive' } },
      { user: { email: { contains: filters.searchTerm, mode: 'insensitive' } } },
    ];
  }

  const [total, providers] = await Promise.all([
    prisma.operatorProfile.count({ where: whereConditions }),
    prisma.operatorProfile.findMany({
      where: whereConditions,
      skip,
      take: limit,
      orderBy: { createdAt: filters.sortOrder === 'asc' ? 'asc' : 'desc' },
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
            routes: true,
          },
        },
      },
    }),
  ]);

  const formattedProviders = providers.map(p => ({
    id: p.id,
    userId: p.userId,
    companyName: p.companyName,
    contactPersonName: p.contactPersonName,
    contactEmail: p.contactEmail,
    businessAddress: p.businessAddress,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    user: p.user,
    ferriesCount: p._count.ferries,
    routesCount: p._count.routes,
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
      routes: {
        include: {
          departurePort: true,
          destinationPort: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      _count: {
        select: {
          ferries: true,
          routes: true,
          offDays: true,
        },
      },
    },
  });

  if (!provider) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Ferry provider profile not found');
  }

  return provider;
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
    throw new ApiError(StatusCodes.NOT_FOUND, 'Ferry provider profile not found');
  }

  return prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: provider.userId },
      data: { status: payload.status },
    });

    let deactivatedTripsCount = 0;

    if (payload.status === AccountStatus.SUSPENDED) {
      const now = new Date();

      // Log the operator out everywhere (same as UserService.updateUserStatus),
      // so open dashboards get a 401 and are sent back to login.
      await tx.session.updateMany({
        where: { userId: provider.userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: RevocationReason.USER_REVOKED },
      });
      const unbookedUpcomingSchedules = await tx.schedule.findMany({
        where: {
          ferry: { operatorId: providerId },
          departureTime: { gt: now },
          bookings: { none: {} },
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

  return prisma.operatorProfile.update({
    where: { userId },
    data: {
      companyName: payload.companyName,
      contactPersonName: payload.contactPersonName,
      contactEmail: payload.contactEmail,
      businessAddress: payload.businessAddress,
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
};

export const ProviderService = {
  listProviders,
  getProviderById,
  updateProviderStatus,
  getOperatorSettings,
  updateOperatorSettings,
};
