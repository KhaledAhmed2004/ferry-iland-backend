import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionService, RevocationReason } from '../session.service';
import { prisma } from '../../../../shared/prisma';
import bcrypt from 'bcrypt';
import ApiError from '../../../../errors/ApiError';
import { StatusCodes } from 'http-status-codes';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed-token-mock'),
    compare: vi.fn(),
  },
}));

describe('SessionService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('creates a session with a 30-day expiration and hashed refresh token', async () => {
      const mockSession = {
        id: 'session-uuid-1',
        userId: 'user-uuid-1',
        refreshTokenHash: 'hashed-token-mock',
        tokenVersion: 1,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      vi.mocked(prisma.session.create).mockResolvedValue(mockSession as any);

      const result = await SessionService.createSession('user-uuid-1');
      expect(prisma.session.create).toHaveBeenCalledOnce();
      expect(result.session).toEqual(mockSession);
      expect(typeof result.plainRefreshToken).toBe('string');
    });
  });

  describe('refreshSession', () => {
    it('successfully rotates session when token and tokenVersion match', async () => {
      const mockSession = {
        id: 'session-1',
        userId: 'user-1',
        refreshTokenHash: 'hashed-1',
        tokenVersion: 1,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000000),
      };

      vi.mocked(prisma.session.findUnique)
        .mockResolvedValueOnce(mockSession as any) // initial check
        .mockResolvedValueOnce({ ...mockSession, tokenVersion: 2 } as any); // post-update fetch

      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 1 } as any);

      const result = await SessionService.refreshSession('session-1', 'raw-token-1');

      expect(prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'session-1',
            tokenVersion: 1,
            revokedAt: null,
          }),
        }),
      );
      expect(result.session.tokenVersion).toBe(2);
      expect(typeof result.newPlainRefreshToken).toBe('string');
    });

    it('detects token reuse and revokes session if token does not match', async () => {
      const mockSession = {
        id: 'session-1',
        userId: 'user-1',
        refreshTokenHash: 'hashed-1',
        tokenVersion: 2,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000000),
      };

      vi.mocked(prisma.session.findUnique).mockResolvedValue(mockSession as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      vi.mocked(prisma.session.update).mockResolvedValue({} as any);

      await expect(
        SessionService.refreshSession('session-1', 'wrong-stolen-token'),
      ).rejects.toThrow(ApiError);

      expect(prisma.session.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({
            revokedReason: RevocationReason.REUSE_DETECTED,
          }),
        }),
      );
    });

    it('handles concurrent race condition safely and throws 409 Conflict', async () => {
      const existingSession = {
        id: 'session-1',
        userId: 'user-1',
        refreshTokenHash: 'hashed-1',
        tokenVersion: 1,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000000),
      };

      const concurrentRotatedSession = {
        ...existingSession,
        tokenVersion: 2, // Rotated by concurrent winner
      };

      vi.mocked(prisma.session.findUnique)
        .mockResolvedValueOnce(existingSession as any) // Initial read
        .mockResolvedValueOnce(concurrentRotatedSession as any); // Read after updateMany returns count: 0

      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      // updateMany fails because expected tokenVersion was 1 but database now has 2
      vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 0 } as any);

      await expect(
        SessionService.refreshSession('session-1', 'raw-token-1'),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.CONFLICT,
        message: expect.stringContaining('Concurrent refresh request detected'),
      });
    });
  });

  describe('revokeSession', () => {
    it('revokes session by id with timestamp and reason', async () => {
      vi.mocked(prisma.session.update).mockResolvedValue({} as any);

      await SessionService.revokeSession('session-1', RevocationReason.USER_LOGOUT);

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: expect.objectContaining({
          revokedReason: RevocationReason.USER_LOGOUT,
        }),
      });
    });
  });

  describe('revokeAllUserSessions', () => {
    it('revokes all active sessions for user with reason', async () => {
      vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 3 } as any);

      await SessionService.revokeAllUserSessions('user-1', RevocationReason.USER_LOGOUT_ALL);

      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          revokedAt: null,
        },
        data: expect.objectContaining({
          revokedReason: RevocationReason.USER_LOGOUT_ALL,
        }),
      });
    });
  });
});
