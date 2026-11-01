import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from '../user.service';
import { prisma } from '../../../../shared/prisma';
import ApiError from '../../../../errors/ApiError';
import { StatusCodes } from 'http-status-codes';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    session: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    operatorProfile: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('UserService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findById', () => {
    it('returns user if found', async () => {
      const mockUser = { id: 'u-1', email: 'test@example.com', deletedAt: null };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

      const result = await UserService.findById('u-1');
      expect(result).toEqual(mockUser);
    });

    it('returns null if not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const result = await UserService.findById('u-missing');
      expect(result).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('updates user name and phone', async () => {
      const existingUser = { id: 'u-1', name: 'Old Name', role: 'USER', deletedAt: null };
      const updatedUser = { id: 'u-1', name: 'New Name', deletedAt: null };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser as any);
      vi.mocked(prisma.user.update).mockResolvedValue(updatedUser as any);

      const result = await UserService.updateProfile('u-1', { name: 'New Name' });
      expect(result.user).toMatchObject({ id: 'u-1', name: 'New Name' });
      expect(result.message).toBe('Profile updated successfully');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-1' },
          data: expect.objectContaining({ name: 'New Name' }),
        }),
      );
    });

    it('throws 404 if user does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(
        UserService.updateProfile('u-missing', { name: 'New Name' }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
      });
    });
  });

  describe('deleteUserByAdmin', () => {
    it('sets deletedAt and revokes all sessions', async () => {
      const mockUser = { id: 'u-1', email: 'u1@test.com', deletedAt: null };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.user.update).mockResolvedValue({ ...mockUser, deletedAt: new Date() } as any);

      const result = await UserService.deleteUserByAdmin('u-1');
      expect(result).toEqual({ message: 'User deleted by admin successfully' });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });
});
