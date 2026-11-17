import { StatusCodes } from 'http-status-codes';
import { Role, AccountStatus, Prisma } from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { PrismaQueryBuilder } from '../../builder';
import { SessionService, RevocationReason } from '../session/session.service';
import bcrypt from 'bcrypt';
import config from '../../../config';

const findById = async (id: string) => {
  return prisma.user.findUnique({
    where: { id },
    include: {
      operatorProfile: true,
    },
  });
};

const getProfile = async (userId: string) => {
  const user = await findById(userId);
  if (!user || user.deletedAt) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  // Exclude sensitive information like passwordHash and deletedAt
  const {
    passwordHash: _passwordHash,
    deletedAt: _deletedAt,
    ...safeUser
  } = user;

  return safeUser;
};

export interface IUpdateProfilePayload {
  name?: string;
  email?: string;
  phoneNumber?: string;
  phone?: string;
  companyName?: string;
  contactPersonName?: string;
  profilePicture?: string;
}

const updateProfile = async (
  userId: string,
  payload: IUpdateProfilePayload,
) => {
  const existing = await findById(userId);
  if (!existing || existing.deletedAt) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  const phone = payload.phoneNumber || payload.phone;
  const updateData: Prisma.UserUpdateInput = {};

  if (payload.name !== undefined && payload.name.trim()) {
    updateData.name = payload.name.trim();
  }
  if (payload.email !== undefined && payload.email.trim()) {
    const trimmedEmail = payload.email.trim().toLowerCase();
    if (trimmedEmail !== existing.email.toLowerCase()) {
      const emailConflict = await prisma.user.findFirst({
        where: { email: trimmedEmail, id: { not: userId } },
      });
      if (emailConflict) {
        throw new ApiError(
          StatusCodes.CONFLICT,
          'Email is already in use by another account',
        );
      }
      updateData.email = trimmedEmail;
    }
  }
  if (phone !== undefined) {
    updateData.phoneNumber = phone ? phone.trim() : null;
  }

  const isOperator = existing.role === Role.OPERATOR;
  if (isOperator && (payload.companyName || payload.contactPersonName)) {
    (updateData as any).operatorProfile = {
      upsert: {
        create: {
          companyName:
            payload.companyName?.trim() ||
            existing.operatorProfile?.companyName ||
            '',
          contactPersonName:
            payload.contactPersonName?.trim() ||
            existing.operatorProfile?.contactPersonName ||
            '',
        },
        update: {
          ...(payload.companyName && {
            companyName: payload.companyName.trim(),
          }),
          ...(payload.contactPersonName && {
            contactPersonName: payload.contactPersonName.trim(),
          }),
        },
      },
    };
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    include: {
      operatorProfile: true,
    },
  });

  const {
    passwordHash: _passwordHash,
    deletedAt: _deletedAt,
    ...safeUser
  } = updatedUser;

  return {
    message: 'Profile updated successfully',
    user: safeUser,
  };
};

const updatePassword = async (
  userId: string,
  payload: {
    oldPassword?: string;
    currentPassword?: string;
    newPassword: string;
  },
) => {
  const oldPassword = payload.oldPassword || payload.currentPassword;
  if (!oldPassword) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Incorrect old password');
  }

  const user = await findById(userId);
  if (!user || user.deletedAt) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  const isValid = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!isValid) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Incorrect old password');
  }

  const newPasswordHash = await bcrypt.hash(
    payload.newPassword,
    Number(config.bcrypt_salt_rounds) || 12,
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newPasswordHash },
  });

  // Important: Revoke all other sessions after a password change to ensure security
  await SessionService.revokeAllUserSessions(
    user.id,
    RevocationReason.PASSWORD_CHANGED,
  );

  return {
    message:
      'Password updated successfully. All devices have been logged out. Please log in again.',
  };
};

const getAllUsers = async (query: Record<string, unknown>) => {
  const roleFilter = query.role
    ? (String(query.role).toUpperCase() as Role)
    : undefined;

  const statusFilter = query.status
    ? (String(query.status).toUpperCase() as AccountStatus)
    : undefined;

  const userQuery = new PrismaQueryBuilder(prisma.user, query, 'User')
    .search(['name', 'email', 'phoneNumber', 'operatorProfile.companyName'])
    .filter({ customExcludes: ['role', 'status'] })
    .where({
      deletedAt: null,
      ...(roleFilter && { role: roleFilter }),
      ...(statusFilter && { status: statusFilter }),
    })
    .include({
      operatorProfile: true,
    })
    .dateFilter('createdAt')
    .sort('-createdAt', [
      'createdAt',
      'name',
      'email',
      'phoneNumber',
      'status',
      'isEmailVerified',
    ])
    .paginate();

  const { data: users, pagination } = await userQuery.execute();

  const data = users.map((u: any) => {
    const { passwordHash: _hash, ...safe } = u;
    return safe;
  });

  return {
    pagination,
    data,
  };
};

const getUserById = async (id: string) => {
  const user = await findById(id);
  if (!user || user.deletedAt) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }
  const { passwordHash: _hash, ...safeUser } = user;
  return safeUser;
};

const updateUserStatus = async (
  id: string,
  status: AccountStatus,
  _reason?: string,
  _adminId?: string,
) => {
  const user = await findById(id);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { status },
    include: { operatorProfile: true },
  });

  if (
    status === AccountStatus.SUSPENDED ||
    status === AccountStatus.DEACTIVATED
  ) {
    await SessionService.revokeAllUserSessions(
      id,
      RevocationReason.USER_REVOKED,
    );
  }

  const { passwordHash: _hash, ...safeUser } = updated;
  return safeUser;
};

const getUserStats = async () => {
  const [
    totalUsers,
    suspendedUsers,
    totalOperators,
    suspendedOperators,
    totalFerries,
  ] = await Promise.all([
    prisma.user.count({ where: { role: Role.USER, deletedAt: null } }),
    prisma.user.count({
      where: {
        role: Role.USER,
        status: AccountStatus.SUSPENDED,
        deletedAt: null,
      },
    }),
    prisma.user.count({ where: { role: Role.OPERATOR, deletedAt: null } }),
    prisma.user.count({
      where: {
        role: Role.OPERATOR,
        status: AccountStatus.SUSPENDED,
        deletedAt: null,
      },
    }),
    prisma.ferry.count(),
  ]);

  return {
    totalPassengers: totalUsers,
    suspendedPassengers: suspendedUsers,
    totalOperators,
    suspendedOperators,
    totalFerries,
  };
};

export const UserService = {
  findById,
  getProfile,
  updateProfile,
  updatePassword,
  getAllUsers,
  getUserById,
  updateUserStatus,
  getUserStats,
};
