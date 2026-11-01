import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import {
  ICreateOffDayPayload,
  IOffDayFilterOptions,
  IUpdateOffDayPayload,
} from './offDay.interface';

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

const createOffDay = async (
  userId: string,
  payload: ICreateOffDayPayload,
) => {
  const operator = await resolveOperatorProfile(userId);

  if (payload.ferryId) {
    const vessel = await prisma.ferry.findUnique({
      where: { id: payload.ferryId },
    });

    if (!vessel || vessel.operatorId !== operator.id) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Ferry vessel not found');
    }
  }

  const offDayDate = new Date(payload.date);
  const startOfDay = new Date(
    Date.UTC(
      offDayDate.getUTCFullYear(),
      offDayDate.getUTCMonth(),
      offDayDate.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );

  const existingOffDay = await prisma.offDay.findFirst({
    where: {
      operatorId: operator.id,
      ferryId: payload.ferryId ?? null,
      date: startOfDay,
    },
  });

  if (existingOffDay) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'An off-day blackout is already scheduled for this vessel and date',
    );
  }

  return prisma.offDay.create({
    data: {
      operatorId: operator.id,
      ferryId: payload.ferryId,
      date: startOfDay,
      reason: payload.reason,
      category: payload.category,
    },
    include: {
      ferry: true,
    },
  });
};

const listOperatorOffDays = async (
  userId: string,
  options: IOffDayFilterOptions,
) => {
  const operator = await resolveOperatorProfile(userId);

  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const skip = (page - 1) * limit;

  const whereClause: Record<string, any> = {
    operatorId: operator.id,
  };

  if (options.ferryId) {
    whereClause.ferryId = options.ferryId;
  }

  if (options.category) {
    whereClause.category = options.category;
  }

  if (options.year) {
    const startOfYear = new Date(Date.UTC(options.year, 0, 1, 0, 0, 0, 0));
    const endOfYear = new Date(Date.UTC(options.year, 11, 31, 23, 59, 59, 999));
    whereClause.date = {
      gte: startOfYear,
      lte: endOfYear,
    };
  }

  const [offDays, totalCount] = await Promise.all([
    prisma.offDay.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { date: 'asc' },
      include: {
        ferry: true,
      },
    }),
    prisma.offDay.count({ where: whereClause }),
  ]);

  return {
    meta: {
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
    data: offDays,
  };
};

const getOffDayById = async (userId: string, offDayId: string) => {
  const operator = await resolveOperatorProfile(userId);

  const offDay = await prisma.offDay.findUnique({
    where: { id: offDayId },
    include: { ferry: true },
  });

  if (!offDay || offDay.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Off-day blackout not found');
  }

  return offDay;
};

const updateOffDay = async (
  userId: string,
  offDayId: string,
  payload: IUpdateOffDayPayload,
) => {
  const operator = await resolveOperatorProfile(userId);

  const existingOffDay = await prisma.offDay.findUnique({
    where: { id: offDayId },
  });

  if (!existingOffDay || existingOffDay.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Off-day blackout not found');
  }

  const updatedDate = payload.date
    ? new Date(
        Date.UTC(
          new Date(payload.date).getUTCFullYear(),
          new Date(payload.date).getUTCMonth(),
          new Date(payload.date).getUTCDate(),
          0,
          0,
          0,
          0,
        ),
      )
    : existingOffDay.date;

  return prisma.offDay.update({
    where: { id: offDayId },
    data: {
      date: updatedDate,
      reason: payload.reason,
      category: payload.category,
      ferryId: payload.ferryId,
    },
    include: { ferry: true },
  });
};

const deleteOffDay = async (userId: string, offDayId: string) => {
  const operator = await resolveOperatorProfile(userId);

  const existingOffDay = await prisma.offDay.findUnique({
    where: { id: offDayId },
  });

  if (!existingOffDay || existingOffDay.operatorId !== operator.id) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Off-day blackout not found');
  }

  await prisma.offDay.delete({
    where: { id: offDayId },
  });

  return { message: 'Off-day blackout deleted successfully' };
};

export const OffDayService = {
  createOffDay,
  listOperatorOffDays,
  getOffDayById,
  updateOffDay,
  deleteOffDay,
};
