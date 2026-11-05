/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import app from '../../../../app';
import config from '../../../../config';
import { jwtHelper } from '../../../../helpers/jwtHelper';
import { USER_ROLES, ACCOUNT_STATE } from '../../../../enums/user';
import { prisma } from '../../../../shared/prisma';

// Port time zone through the real Express stack (auth, validation, service), Prisma mocked.
// Spec 0003: AC-1 (required valid zone, admin only) and AC-11 (zone change guard).
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
    schedule: { count: vi.fn() },
    $transaction: vi.fn(),
  };
  mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
  return { prisma: mockPrisma, default: mockPrisma };
});

describe('Port API: time zone (spec 0003)', () => {
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
    timeZone: 'America/Lower_Princes',
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

  describe('POST /api/v1/ports (covers: AC-1)', () => {
    it('400 when the time zone is missing', async () => {
      const res = await request(app)
        .post('/api/v1/ports')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'New Harbour' });

      expect(res.status).toBe(StatusCodes.BAD_REQUEST);
      expect(prisma.port.create).not.toHaveBeenCalled();
    });

    it('400 when the time zone is not a real IANA name', async () => {
      const res = await request(app)
        .post('/api/v1/ports')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'New Harbour', timeZone: 'Mars/Olympus' });

      expect(res.status).toBe(StatusCodes.BAD_REQUEST);
      expect(prisma.port.create).not.toHaveBeenCalled();
    });

    it('201 and stores the zone when it is valid', async () => {
      vi.mocked(prisma.port.create).mockImplementation((async (args: any) => ({
        id: 'new-port',
        ...args.data,
      })) as any);

      const res = await request(app)
        .post('/api/v1/ports')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'New Harbour', timeZone: 'America/Anguilla' });

      expect(res.status).toBe(StatusCodes.CREATED);
      expect(res.body.data.timeZone).toBe('America/Anguilla');
    });
  });

  describe('PATCH /api/v1/ports/:id (covers: AC-1, AC-11)', () => {
    it('403 for a customer: only an admin may set a zone', async () => {
      const res = await request(app)
        .patch(`/api/v1/ports/${philipsburg.id}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ timeZone: 'America/St_Kitts' });

      expect(res.status).toBe(StatusCodes.FORBIDDEN);
      expect(prisma.port.update).not.toHaveBeenCalled();
    });

    it('403 for an operator: only an admin may set a zone', async () => {
      const res = await request(app)
        .patch(`/api/v1/ports/${philipsburg.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ timeZone: 'America/St_Kitts' });

      expect(res.status).toBe(StatusCodes.FORBIDDEN);
      expect(prisma.port.update).not.toHaveBeenCalled();
    });

    it('401 without a token', async () => {
      const res = await request(app)
        .patch(`/api/v1/ports/${philipsburg.id}`)
        .send({ timeZone: 'America/St_Kitts' });

      expect(res.status).toBe(StatusCodes.UNAUTHORIZED);
    });

    it('409 with the upcoming trip count while trips use the port', async () => {
      vi.mocked(prisma.schedule.count).mockResolvedValue(248);

      const res = await request(app)
        .patch(`/api/v1/ports/${philipsburg.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ timeZone: 'America/St_Kitts' });

      expect(res.status).toBe(StatusCodes.CONFLICT);
      expect(res.body.message).toBe(
        'Cannot change time zone: 248 upcoming trips depart from or arrive at this port',
      );
      expect(res.body.data).toEqual({ field: 'timeZone', upcomingTrips: 248 });
      expect(prisma.port.update).not.toHaveBeenCalled();
    });

    it('200 when the same zone is sent again (no op, no trip count needed)', async () => {
      const res = await request(app)
        .patch(`/api/v1/ports/${philipsburg.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ timeZone: 'America/Lower_Princes' });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.data.timeZone).toBe('America/Lower_Princes');
      expect(prisma.schedule.count).not.toHaveBeenCalled();
    });
  });
});
