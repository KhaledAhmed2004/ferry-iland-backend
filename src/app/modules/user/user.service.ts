import { StatusCodes } from 'http-status-codes';
import { JwtPayload } from 'jsonwebtoken';
import { Role, AccountStatus, Prisma, User } from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { PrismaQueryBuilder } from '../../builder';
import { SessionService, RevocationReason } from '../session/session.service';
import bcrypt from 'bcrypt';
import config from '../../../config';

// ==========================================
// Core NestJS UsersService Implementation
// ==========================================

const create = async (data: Prisma.UserCreateInput): Promise<User> => {
  return prisma.user.create({ data });
};

const findByEmail = async (email: string) => {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: {
      operatorProfile: true,
    },
  });
};

const findById = async (id: string) => {
  return prisma.user.findUnique({
    where: { id },
    include: {
      operatorProfile: true,
    },
  });
};

const update = async (id: string, data: Prisma.UserUpdateInput): Promise<User> => {
  return prisma.user.update({
    where: { id },
    data,
  });
};

// ==========================================
// NestJS UsersController Business Logic
// ==========================================

const getAdminDashboard = async () => {
  return { message: 'Welcome to the secret admin dashboard!' };
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
        throw new ApiError(StatusCodes.CONFLICT, 'Email is already in use by another account');
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
          companyName: payload.companyName?.trim() || existing.operatorProfile?.companyName || '',
          contactPersonName: payload.contactPersonName?.trim() || existing.operatorProfile?.contactPersonName || '',
        },
        update: {
          ...(payload.companyName && { companyName: payload.companyName.trim() }),
          ...(payload.contactPersonName && { contactPersonName: payload.contactPersonName.trim() }),
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
  payload: { oldPassword?: string; currentPassword?: string; newPassword: string },
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

const getUserSessions = async (userId: string) => {
  const sessions = await SessionService.findUserSessions(userId);

  // Omit sensitive refresh token hash from the response
  return sessions.map((session) => {
    const { refreshTokenHash: _refreshTokenHash, ...safeSession } = session;
    return safeSession;
  });
};

const revokeSession = async (userId: string, sessionId: string) => {
  // Ensure the session belongs to the user
  const sessions = await SessionService.findUserSessions(userId);
  const sessionExists = sessions.find((s) => s.id === sessionId);

  if (!sessionExists) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found or already revoked');
  }

  await SessionService.revokeSession(sessionId, RevocationReason.USER_REVOKED);
  return { message: 'Session revoked successfully' };
};

// ==========================================
// Platform Admin User Management (Tier 3)
// ==========================================

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
    .sort('-createdAt', ['createdAt', 'name', 'email'])
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

  if (status === AccountStatus.SUSPENDED || status === AccountStatus.DEACTIVATED) {
    await SessionService.revokeAllUserSessions(id, RevocationReason.USER_REVOKED);
  }

  const { passwordHash: _hash, ...safeUser } = updated;
  return safeUser;
};

const suspendUser = async (id: string, reason?: string, adminId?: string) => {
  return updateUserStatus(id, AccountStatus.SUSPENDED, reason, adminId);
};

const reactivateUser = async (id: string, adminId?: string) => {
  return updateUserStatus(id, AccountStatus.ACTIVE, undefined, adminId);
};

const deleteAccountFromDB = async (userId: string, payload?: { password?: string }) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  const password = payload?.password;
  if (password && user.passwordHash) {
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Incorrect password');
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt: new Date(),
      status: AccountStatus.DEACTIVATED,
    },
  });

  await SessionService.revokeAllUserSessions(userId, RevocationReason.USER_REVOKED);
  return { message: 'Account deleted successfully' };
};

const deleteUserByAdmin = async (userId: string) => {
  await prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt: new Date(),
      status: AccountStatus.DEACTIVATED,
    },
  });

  await SessionService.revokeAllUserSessions(userId, RevocationReason.USER_REVOKED);
  return { message: 'User deleted by admin successfully' };
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
    prisma.user.count({ where: { role: Role.USER, status: AccountStatus.SUSPENDED, deletedAt: null } }),
    prisma.user.count({ where: { role: Role.OPERATOR, deletedAt: null } }),
    prisma.user.count({ where: { role: Role.OPERATOR, status: AccountStatus.SUSPENDED, deletedAt: null } }),
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

const createUserByAdmin = async (payload: any) => {
  const email = payload.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ApiError(StatusCodes.CONFLICT, 'Email already in use');
  }

  const passwordHash = await bcrypt.hash(payload.password || 'TempPassword123!', 12);
  const isOperator = payload.role === Role.OPERATOR;
  const role: Role = isOperator ? Role.OPERATOR : (payload.role === Role.ADMIN ? Role.ADMIN : Role.USER);

  const newUser = await prisma.user.create({
    data: {
      name: payload.name || '',
      email,
      phoneNumber: payload.phoneNumber || payload.phone || null,
      passwordHash,
      role,
      status: AccountStatus.ACTIVE,
      isEmailVerified: true,
      ...(isOperator && (payload.companyName || payload.contactPersonName)
        ? {
            operatorProfile: {
              create: {
                companyName: (payload.companyName || payload.name || '').trim(),
                contactPersonName: (payload.contactPersonName || payload.name || '').trim(),
              },
            },
          }
        : {}),
    },
    include: {
      operatorProfile: true,
    },
  });

  const { passwordHash: _hash, ...safeUser } = newUser;
  return safeUser;
};

export const UserService = {
  create,
  findByEmail,
  findById,
  update,
  getAdminDashboard,
  getProfile,
  updateProfile,
  updatePassword,
  getUserSessions,
  revokeSession,
  getAllUsers,
  getAllUserRoles: getAllUsers,
  getUserById,
  getUserDetailsById: getUserById,
  updateUserStatus,
  suspendUser,
  blockUser: suspendUser,
  reactivateUser,
  unblockUser: reactivateUser,
  approveUser: reactivateUser,
  rejectUser: suspendUser,
  deleteAccountFromDB,
  deleteUserByAdmin,
  getUserStats,
  createUserByAdmin,
  // Backward compatibility
  getUserProfileFromDB: async (user: JwtPayload) => {
    const userId = user.id || (user as any).userId || (user as any)._id;
    return getProfile(userId);
  },
  updateProfileToDB: async (user: JwtPayload, payload: any) => {
    const userId = user.id || (user as any).userId || (user as any)._id;
    return updateProfile(userId, payload);
  },
};
