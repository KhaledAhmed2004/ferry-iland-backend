/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import app from '../../../../app';
import config from '../../../../config';
import { jwtHelper } from '../../../../helpers/jwtHelper';
import { USER_ROLES, ACCOUNT_STATE } from '../../../../enums/user';
import { prisma } from '../../../../shared/prisma';

// Trip search and schedule input through the real Express stack, Prisma mocked (spec 0003).
vi.mock('../../../../shared/prisma', () => {
  const mockPrisma: any = {
    user: { findUnique: vi.fn() },
    session: { findUnique: vi.fn() },
    port: { findFirst: vi.fn() },
    schedule: { findMany: vi.fn() },
  };
  return { prisma: mockPrisma, default: mockPrisma };
});

const philipsburg = { id: 'port-phi', name: 'Philipsburg, Sint Maarten', timeZone: 'America/Lower_Princes' };
const saba = { id: 'port-saba', name: 'Fort Bay Harbor, Saba', timeZone: 'America/Kralendijk' };

const sailing = (departureIso: string, minutes = 90) => ({
  id: `trip-${departureIso}`,
  departureTime: new Date(departureIso),
  arrivalTime: new Date(new Date(departureIso).getTime() + minutes * 60000),
  availableSeats: 40,
  adultFare: 55,
  childFare: 33,
  status: 'ON_TIME',
  ferry: { name: 'Royal Alpha', type: 'CATAMARAN', imageUrl: 'https://img.test/a.jpg' },
  route: {
    operatorId: 'op-1',
    operator: { companyName: 'Makana' },
    departurePort: philipsburg,
    destinationPort: saba,
  },
});

const search = (departureDate: string) =>
  request(app)
    .get('/api/v1/trips/search')
    .query({ from: philipsburg.name, to: saba.name, departureDate, adults: 1 });

describe('GET /api/v1/trips/search: port local days and times (spec 0003)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.port.findFirst).mockImplementation((async (args: any) => {
      const text = JSON.stringify(args.where);
      return text.includes('Saba') ? saba : philipsburg;
    }) as any);
  });

  it('every trip carries both port zones and port local clock strings (covers: AC-3, rule 4)', async () => {
    // 12:30Z is 08:30 AST at Philipsburg; arrival 14:00Z is 10:00 AST at Saba.
    vi.mocked(prisma.schedule.findMany).mockResolvedValue([sailing('2099-11-06T12:30:00.000Z')] as any);

    const res = await search('2099-11-06');

    expect(res.status).toBe(StatusCodes.OK);
    const [trip] = res.body.data.outboundTrips;
    expect(trip).toMatchObject({
      departureTime: '08:30 AM',
      arrivalTime: '10:00 AM',
      departureAt: '2099-11-06T12:30:00.000Z',
      departureTimeZone: 'America/Lower_Princes',
      arrivalTimeZone: 'America/Kralendijk',
    });
  });

  it('a 21:00 AST sailing falls inside its own local day, not the next UTC day (covers: AC-2)', async () => {
    vi.mocked(prisma.schedule.findMany).mockResolvedValue([]);
    const evening = new Date('2099-11-07T01:00:00.000Z'); // 21:00 AST on 6 Nov

    await search('2099-11-06');
    const sameDay = vi.mocked(prisma.schedule.findMany).mock.calls[0][0]!.where as any;
    await search('2099-11-07');
    const nextDay = vi.mocked(prisma.schedule.findMany).mock.calls[1][0]!.where as any;

    expect(evening >= sameDay.departureTime.gte && evening <= sameDay.departureTime.lte).toBe(true);
    expect(evening >= nextDay.departureTime.gte).toBe(false);
  });

  it('a date already past at the port asks for an empty window and returns no trips (covers: rule 1)', async () => {
    vi.mocked(prisma.schedule.findMany).mockResolvedValue([]);

    const res = await search('2020-01-01');

    const where = vi.mocked(prisma.schedule.findMany).mock.calls[0][0]!.where as any;
    expect(where.departureTime.gte.getTime()).toBeGreaterThan(where.departureTime.lte.getTime());
    expect(res.status).toBe(StatusCodes.OK);
    expect(res.body.data.outboundTrips).toEqual([]);
  });
});

describe('POST /api/v1/schedules: time input shapes (covers: AC-6, rule 7)', () => {
  const jwtSecret = (config.jwt.jwt_secret || 'jwt_secret') as string;
  if (!config.jwt.jwt_secret) config.jwt.jwt_secret = jwtSecret;
  const operatorToken = jwtHelper.createToken(
    { id: 'op-user-1', email: 'op@test.local', role: USER_ROLES.OPERATOR, accountState: ACCOUNT_STATE.VERIFIED, status: 'ACTIVE' },
    jwtSecret,
    '1d',
  );
  const body = (departureTime: string, arrivalTime: string) => ({
    routeId: '11111111-1111-4111-8111-111111111111',
    ferryId: '22222222-2222-4222-8222-222222222222',
    departureTime,
    arrivalTime,
    adultFare: 55,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ status: 'ACTIVE', deletedAt: null } as never);
  });

  it.each([
    ['a date with no time', '2099-11-06', '2099-11-06'],
    ['a free text time', 'tomorrow 8am', 'tomorrow 10am'],
  ])('400 for %s', async (_label, departure, arrival) => {
    const res = await request(app)
      .post('/api/v1/schedules')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send(body(departure, arrival));

    expect(res.status).toBe(StatusCodes.BAD_REQUEST);
  });
});
