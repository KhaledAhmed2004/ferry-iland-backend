import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { UnauthorizedException, ConflictException } from '../../../errors';
import { prisma } from '../../../shared/prisma';
import { Session } from '@prisma/client';

export const SESSION_LIFETIME_DAYS = 30;

export const RevocationReason = {
  USER_LOGOUT: 'USER_LOGOUT',
  USER_LOGOUT_ALL: 'USER_LOGOUT_ALL',
  USER_REVOKED: 'USER_REVOKED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  REUSE_DETECTED: 'REUSE_DETECTED',
} as const;

export type RevocationReason =
  (typeof RevocationReason)[keyof typeof RevocationReason];

export interface SessionWithToken {
  session: Session;
  plainRefreshToken: string;
}

export interface RefreshedSessionResult {
  session: Session;
  newPlainRefreshToken: string;
}

const generateRandomToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

const calculateExpirationDate = (): Date => {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + SESSION_LIFETIME_DAYS);
  return expirationDate;
};

const createSession = async (
  userId: string,
  deviceInfo?: string,
  ipAddress?: string,
): Promise<SessionWithToken> => {
  const plainRefreshToken = generateRandomToken();
  const refreshTokenHash = await bcrypt.hash(plainRefreshToken, 12);
  const expiresAt = calculateExpirationDate();

  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash,
      deviceInfo,
      ipAddress,
      expiresAt,
      lastUsedAt: new Date(),
      revokedAt: null,
      revokedReason: null,
    },
  });

  return { session, plainRefreshToken };
};

const refreshSession = async (
  sessionId: string,
  providedRefreshToken: string,
  ipAddress?: string,
  deviceInfo?: string,
): Promise<RefreshedSessionResult> => {
  if (!sessionId) {
    throw new UnauthorizedException('Invalid session');
  }

  const existingSession = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!existingSession) {
    throw new UnauthorizedException('Invalid session');
  }

  if (existingSession.revokedAt) {
    throw new UnauthorizedException('Session has been revoked');
  }

  if (existingSession.expiresAt < new Date()) {
    throw new UnauthorizedException('Session expired');
  }

  const isTokenMatching = await bcrypt.compare(
    providedRefreshToken,
    existingSession.refreshTokenHash,
  );

  if (!isTokenMatching) {
    await revokeSession(sessionId, RevocationReason.REUSE_DETECTED);
    throw new UnauthorizedException('Invalid refresh token');
  }

  const newPlainRefreshToken = generateRandomToken();
  const newRefreshTokenHash = await bcrypt.hash(newPlainRefreshToken, 12);
  const newExpiresAt = calculateExpirationDate();

  const updateResult = await prisma.session.updateMany({
    where: {
      id: sessionId,
      tokenVersion: existingSession.tokenVersion,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: {
      refreshTokenHash: newRefreshTokenHash,
      tokenVersion: { increment: 1 },
      expiresAt: newExpiresAt,
      lastUsedAt: new Date(),
      ipAddress: ipAddress || existingSession.ipAddress,
      deviceInfo: deviceInfo || existingSession.deviceInfo,
    },
  });

  if (updateResult.count === 0) {
    const latestSession = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!latestSession || latestSession.revokedAt) {
      throw new UnauthorizedException('Session has been revoked');
    }

    if (latestSession.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired');
    }

    if (latestSession.tokenVersion > existingSession.tokenVersion) {
      throw new ConflictException(
        'Concurrent refresh request detected. Please retry with the latest token.',
      );
    }

    await revokeSession(sessionId, RevocationReason.REUSE_DETECTED);
    throw new UnauthorizedException('Invalid refresh token');
  }

  const updatedSession = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!updatedSession) {
    throw new UnauthorizedException('Session not found');
  }

  return { session: updatedSession, newPlainRefreshToken };
};

const revokeSession = async (
  sessionId: string,
  reason: string = RevocationReason.USER_LOGOUT,
) => {
  return prisma.session.update({
    where: { id: sessionId },
    data: {
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });
};

const findUserSessions = async (userId: string): Promise<Session[]> => {
  return prisma.session.findMany({
    where: {
      userId,
      revokedAt: null,
    },
    orderBy: {
      lastUsedAt: 'desc',
    },
  });
};

const revokeAllUserSessions = async (
  userId: string,
  reason: string = RevocationReason.USER_LOGOUT_ALL,
) => {
  return prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });
};

export const SessionService = {
  createSession,
  refreshSession,
  revokeSession,
  findUserSessions,
  revokeAllUserSessions,
};
