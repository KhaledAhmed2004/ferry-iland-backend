import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Secret } from 'jsonwebtoken';
import { Role, AccountStatus } from '@prisma/client';
import config from '../../config';
import ApiError from '../../errors/ApiError';
import { jwtHelper } from '../../helpers/jwtHelper';
import { USER_ROLES, ACCOUNT_STATE } from '../../enums/user';
import { JwtUser } from '../../types';
import prisma from '../../shared/prisma';

export type AuthOptions = {
  allowRestricted?: boolean;
  allowPending?: boolean;
  optional?: boolean;
};

export const AUTH_POLICIES = {
  ALLOW_PENDING_ONBOARDING: { allowPending: true },
  OPTIONAL: { optional: true },
  ALLOW_RESTRICTED: { allowRestricted: true },
} as const;

type AuthArgument = Role | USER_ROLES | string | AuthOptions;

const isJwtUser = (payload: unknown): payload is JwtUser => {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'role' in payload &&
    typeof (payload as { role: unknown }).role === 'string' &&
    'id' in payload &&
    typeof (payload as { id: unknown }).id === 'string'
  );
};

const checkAccountStatus = (user: JwtUser, options: AuthOptions): void => {
  const currentStatus = (user.status || user.accountState) as string | undefined;

  const isSuspended =
    currentStatus === AccountStatus.SUSPENDED ||
    currentStatus === ACCOUNT_STATE.SUSPENDED;

  if (isSuspended && !options.allowRestricted) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Your account has been restricted. Contact support.',
    );
  }

  const isLocked =
    currentStatus === AccountStatus.LOCKED ||
    currentStatus === ACCOUNT_STATE.LOCKED;

  if (isLocked) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Your account is temporarily locked due to security reasons. Contact support.',
    );
  }

  const isDeactivated =
    currentStatus === AccountStatus.DEACTIVATED ||
    currentStatus === ACCOUNT_STATE.DEACTIVATED;

  if (isDeactivated) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Your account has been deactivated.',
    );
  }

  const isPending =
    currentStatus === AccountStatus.UNVERIFIED ||
    currentStatus === ACCOUNT_STATE.UNVERIFIED;

  if (isPending && !options.allowPending) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Your account is pending admin approval. Please wait until your account is verified by an administrator.',
    );
  }
};

/**
 * The JWT carries the status from login time, so suspending, deactivating or
 * deleting an account (or revoking the session) must be checked against the DB.
 * Returns the live account status; throws 401 when the token no longer maps to a usable session.
 */
const getLiveAccountStatus = async (user: JwtUser): Promise<AccountStatus> => {
  if (user.sessionId) {
    const session = await prisma.session.findUnique({
      where: { id: user.sessionId },
      select: {
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { status: true, deletedAt: true } },
      },
    });

    if (
      !session ||
      session.userId !== user.id ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        'Session has been revoked or expired. Please log in again.',
      );
    }
    if (session.user.deletedAt) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Account no longer exists');
    }
    return session.user.status;
  }

  // Tokens minted without a session (e.g. admin credential reset) — check the account only.
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { status: true, deletedAt: true },
  });
  if (!account || account.deletedAt) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Account no longer exists');
  }
  return account.status;
};

const checkRoleAccess = (userRole: string, allowedRoles: string[]): void => {
  if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You don't have permission to access this API",
    );
  }
};

const formatJwtError = (error: unknown): ApiError | null => {
  if (error instanceof Error) {
    if (error.name === 'JsonWebTokenError') {
      return new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid token');
    }
    if (error.name === 'TokenExpiredError') {
      return new ApiError(StatusCodes.UNAUTHORIZED, 'Token has expired');
    }
    if (error.name === 'NotBeforeError') {
      return new ApiError(StatusCodes.UNAUTHORIZED, 'Token not active');
    }
  }
  return null;
};

const auth = (...args: AuthArgument[]) => {
  const allowedRoles = args.filter(
    (arg): arg is USER_ROLES | string => typeof arg === 'string',
  );
  const options: AuthOptions =
    args.find(
      (arg): arg is AuthOptions => typeof arg === 'object' && arg !== null,
    ) ?? {};

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        if (options.optional) {
          return next();
        }
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          'Authorization token is required',
        );
      }

      if (!authHeader.startsWith('Bearer ')) {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          'Authorization header must start with "Bearer "',
        );
      }

      const token = authHeader.slice(7).trim();
      if (!token) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'Valid token is required');
      }

      const verifiedPayload = jwtHelper.verifyToken(
        token,
        config.jwt.jwt_secret as Secret,
      );

      if (!isJwtUser(verifiedPayload)) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid token payload');
      }

      if (/^[0-9a-fA-F]{24}$/.test(verifiedPayload.id)) {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          'Session is invalid or using a legacy identifier. Please log in again.',
        );
      }

      // Role check needs no DB hit — reject wrong-role requests before querying.
      checkRoleAccess(verifiedPayload.role, allowedRoles);

      const liveStatus = await getLiveAccountStatus(verifiedPayload);
      const liveUser: JwtUser = {
        ...verifiedPayload,
        status: liveStatus,
        // Same mapping as login (auth.service): ACTIVE → VERIFIED, otherwise the status itself.
        accountState: liveStatus === AccountStatus.ACTIVE ? ACCOUNT_STATE.VERIFIED : liveStatus,
      };

      checkAccountStatus(liveUser, options);
      req.user = liveUser;

      next();
    } catch (error: unknown) {
      const jwtError = formatJwtError(error);
      if (jwtError) {
        return next(jwtError);
      }

      next(error);
    }
  };
};

export default auth;
