/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import app from '../../../../app';
import config from '../../../../config';
import { jwtHelper } from '../../../../helpers/jwtHelper';
import { USER_ROLES, ACCOUNT_STATE } from '../../../../enums/user';
import { prisma } from '../../../../shared/prisma';

// Port create/update through the real Express stack (auth, validation, service), Prisma mocked.
vi.mock('../../../../shared/prisma', () => {
  const mockPrisma: any = {
    user: { findUnique: vi.fn() },
    session: { findUnique: vi.fn() },
    port: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  return { prisma: mockPrisma, default: mockPrisma };
});

describe('Port API: create and update', () => {
  const jwtSecret = (config.jwt.jwt_secret || 'jwt_secret') as string;
  if (!config.jwt.jwt_secret) config.jwt.jwt_secret = jwtSecret;

  const token = (id: string, role: string) =>
    jwtHelper.createToken(
      { id, email: `${id}@test.local`, role, accountState: ACCOUNT_STATE.VERIFIED, status: 'ACTIVE' },
      jwtSecret,
      '1d',
    );
  const adminToken = token('admin-1', USER_ROLES.ADMIN);
  const customerToken = token('user-1', USER_ROLES.USER);
  const operatorToken = token('operator-1', USER_ROLES.OPERATOR);

  const philipsburg = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Philipsburg, Sint Maarten',
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ status: 'ACTIVE', deletedAt: null } as never);
    vi.mocked(prisma.port.findUnique).mockResolvedValue(philipsburg as never);
    vi.mocked(prisma.port.update).mockImplementation((async (args: any) => ({
      ...philipsburg,
      ...args.data,
    })) as any);
  });

  describe('POST /api/v1/ports', () => {
    it('400 when the name is missing', async () => {
      const res = await request(app)
        .post('/api/v1/ports')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(StatusCodes.BAD_REQUEST);
      expect(prisma.port.create).not.toHaveBeenCalled();
    });

    it('201 when the payload is valid', async () => {
      vi.mocked(prisma.port.create).mockImplementation((async (args: any) => ({
        id: 'new-port',
        ...args.data,
      })) as any);

      const res = await request(app)
        .post('/api/v1/ports')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'New Harbour' });

      expect(res.status).toBe(StatusCodes.CREATED);
      expect(res.body.data.name).toBe('New Harbour');
    });
  });

  describe('PATCH /api/v1/ports/:id', () => {
    it('403 for a customer: only an admin may edit a port', async () => {
      const res = await request(app)
        .patch(`/api/v1/ports/${philipsburg.id}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'Renamed Harbour' });

      expect(res.status).toBe(StatusCodes.FORBIDDEN);
      expect(prisma.port.update).not.toHaveBeenCalled();
    });

    it('403 for an operator: only an admin may edit a port', async () => {
      const res = await request(app)
        .patch(`/api/v1/ports/${philipsburg.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Renamed Harbour' });

      expect(res.status).toBe(StatusCodes.FORBIDDEN);
      expect(prisma.port.update).not.toHaveBeenCalled();
    });

    it('401 without a token', async () => {
      const res = await request(app)
        .patch(`/api/v1/ports/${philipsburg.id}`)
        .send({ name: 'Renamed Harbour' });

      expect(res.status).toBe(StatusCodes.UNAUTHORIZED);
    });

    it('200 for an admin', async () => {
      const res = await request(app)
        .patch(`/api/v1/ports/${philipsburg.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Renamed Harbour' });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.data.name).toBe('Renamed Harbour');
    });
  });
});
