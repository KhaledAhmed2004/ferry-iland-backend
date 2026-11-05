/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import {
  BoardingStatus,
  BookingStatus,
  CabinClass,
  RouteStatus,
  TripStatus,
  VesselStatus,
  VesselType,
} from '@prisma/client';
import app from '../../../../app';
import config from '../../../../config';
import { jwtHelper } from '../../../../helpers/jwtHelper';
import { USER_ROLES, ACCOUNT_STATE } from '../../../../enums/user';
import { prisma } from '../../../../shared/prisma';

// Mock Prisma so that E2E tests execute deterministically against the Express application stack
vi.mock('../../../../shared/prisma', () => {
  const mockPrisma: any = {
    // Read by the auth middleware on every authenticated request
    user: {
      findUnique: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(callback => callback(mockPrisma)),
    operatorProfile: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    ferry: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    route: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    port: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    schedule: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    booking: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    ticket: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    offDay: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  };

  return {
    prisma: mockPrisma,
    default: mockPrisma,
  };
});

// Structured Logger for E2E Test execution to display payloads and responses clearly
interface ITestLogDetails {
  scenario: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  endpoint: string;
  authRole?: string;
  queryParams?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  responseStatus: number;
  responseBody: unknown;
}

const logE2EStep = ({
  scenario,
  method,
  endpoint,
  authRole,
  queryParams,
  payload,
  responseStatus,
  responseBody,
}: ITestLogDetails) => {
  console.log(
    '\n┌─────────────────────────────────────────────────────────────────────────────',
  );
  console.log(`│ 🧪 [E2E SCENARIO]: ${scenario}`);
  console.log(`│ 🌐 [HTTP REQUEST]: [${method}] ${endpoint}`);
  console.log(
    `│ 🔑 [AUTHORIZATION]: ${authRole ? `Bearer Token (${authRole})` : 'None (Unauthenticated)'}`,
  );

  if (queryParams && Object.keys(queryParams).length > 0) {
    console.log(`│ 🔍 [QUERY PARAMS]:`);
    console.log(
      JSON.stringify(queryParams, null, 2)
        .split('\n')
        .map(line => `│    ${line}`)
        .join('\n'),
    );
  }

  if (payload && Object.keys(payload).length > 0) {
    console.log(`│ 📦 [REQUEST PAYLOAD]:`);
    console.log(
      JSON.stringify(payload, null, 2)
        .split('\n')
        .map(line => `│    ${line}`)
        .join('\n'),
    );
  }

  console.log(`│ ⚡ [RESPONSE STATUS]: ${responseStatus}`);
  console.log(`│ 📥 [RESPONSE BODY]:`);
  console.log(
    JSON.stringify(responseBody, null, 2)
      .split('\n')
      .map(line => `│    ${line}`)
      .join('\n'),
  );
  console.log(
    '└─────────────────────────────────────────────────────────────────────────────\n',
  );
};

describe('Operator Module E2E Test Suite (Overview, Settings, Manifest & Bookings)', () => {
  const jwtSecret = (config.jwt.jwt_secret || 'jwt_secret') as string;
  if (!config.jwt.jwt_secret) {
    config.jwt.jwt_secret = jwtSecret;
  }

  // Operator User & Profile
  const mockOperatorUser = {
    id: 'user-operator-101',
    email: 'operator@islandhop.com',
    role: USER_ROLES.OPERATOR,
    accountState: ACCOUNT_STATE.VERIFIED,
    status: 'ACTIVE',
  };

  const mockOperatorProfile = {
    id: 'op-profile-501',
    userId: mockOperatorUser.id,
    companyName: 'Island Hop Express Ferry Ltd',
    contactPersonName: 'Captain Ahmed',
    contactEmail: 'ahmed@islandhop.com',
    businessAddress: 'Pier 4, Male Harbor Terminal',
    businessRegNumber: 'REG-MV-2026-09',
    user: {
      id: mockOperatorUser.id,
      email: mockOperatorUser.email,
      name: 'Captain Ahmed',
      phoneNumber: '+9607788990',
      status: 'ACTIVE',
    },
  };

  // Regular Passenger / Customer User (for RBAC testing)
  const mockCustomerUser = {
    id: 'user-customer-301',
    email: 'passenger@example.com',
    role: USER_ROLES.USER,
    accountState: ACCOUNT_STATE.VERIFIED,
    status: 'ACTIVE',
  };

  const operatorToken = jwtHelper.createToken(
    mockOperatorUser,
    jwtSecret,
    '1d',
  );

  const customerToken = jwtHelper.createToken(
    mockCustomerUser,
    jwtSecret,
    '1d',
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ status: 'ACTIVE', deletedAt: null } as never);
  });

  // =========================================================================
  // 1. GET /api/v1/operator/overview (OPERATOR DASHBOARD OVERVIEW & KPIS)
  // =========================================================================
  describe('1. GET /api/v1/operator/overview (Overview Command Center)', () => {
    it('200 OK: Successfully retrieves operator dashboard summary with KPIs and departures', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );

      vi.mocked(prisma.ferry.findMany).mockResolvedValue([
        { id: 'ferry-1', status: VesselStatus.IN_SERVICE },
        { id: 'ferry-2', status: VesselStatus.IN_SERVICE },
      ] as any);

      const mockTodaySchedule = {
        id: 'sch-today-1',
        departureTime: new Date(),
        arrivalTime: new Date(Date.now() + 45 * 60000),
        gate: 'Gate 2',
        captain: 'Capt. Ibrahim',
        status: TripStatus.ON_TIME,
        availableSeats: 30,
        route: {
          id: 'route-1',
          departurePort: { name: 'Malé', code: 'MLE', timeZone: 'America/Anguilla' },
          destinationPort: { name: 'Hulhumalé', code: 'HUL', timeZone: 'America/Anguilla' },
        },
        ferry: {
          id: 'ferry-1',
          name: 'Ocean Express I',
          capacity: 50,
        },
        bookings: [
          {
            tickets: [{ id: 'tck-1' }, { id: 'tck-2' }],
          },
        ],
      };

      vi.mocked(prisma.schedule.findMany)
        .mockResolvedValueOnce([mockTodaySchedule] as any)
        .mockResolvedValueOnce([mockTodaySchedule] as any)
        // Today's departures at each port's own today (spec 0003, rule 16).
        .mockResolvedValueOnce([mockTodaySchedule] as any);

      vi.mocked(prisma.booking.findMany)
        .mockResolvedValueOnce([
          {
            totalAmount: 100,
            payment: {
              status: 'COMPLETED',
              provider: 'STRIPE',
              amountCents: 10000,
              platformCommissionCents: 1000,
              operatorPayoutCents: 9000,
            },
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            id: 'bk-recent-1',
            reference: 'FRY-20261025-001',
            leadPassengerName: 'Elena Rodriguez',
            leadPassengerEmail: 'elena@example.com',
            status: BookingStatus.CHECKED_IN,
            totalAmount: 180,
            createdAt: new Date(),
            tickets: [
              { id: 'tck-1' },
              { id: 'tck-2' },
              { id: 'tck-3' },
              { id: 'tck-4' },
            ],
            schedule: {
              departureTime: new Date(),
              route: {
                departurePort: { name: 'Honolulu', code: 'HNL' },
                destinationPort: { name: 'Maui', code: 'OGG' },
              },
              ferry: { name: 'Ocean Express I' },
            },
          },
        ] as any);

      const res = await request(app)
        .get('/api/v1/operator/overview')
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Retrieve operator overview command center data',
        method: 'GET',
        endpoint: '/api/v1/operator/overview',
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Operator overview retrieved successfully');
      expect(res.body.data.kpis).toBeDefined();
      expect(res.body.data.kpis.activeFleet.ratio).toBe('2/2');
      expect(res.body.data.kpis.todayPassengers.value).toBe(2);
      expect(res.body.data.kpis.todayPassengers.comparedPeriod).toBe('yesterday');
      expect(res.body.data.kpis.netRevenue.value).toBe(90);
      expect(res.body.data.kpis.netRevenue.comparedPeriod).toBe('yesterday');
      expect(res.body.data.todayDepartures).toHaveLength(1);
      expect(res.body.data.recentBookings).toBeDefined();
      expect(res.body.data.recentBookings).toHaveLength(1);
      expect(res.body.data.recentBookings[0].reference).toBe('FRY-20261025-001');
      expect(res.body.data.recentBookings[0].passenger).toBe('Elena Rodriguez');
      expect(res.body.data.recentBookings[0].pax).toBe(4);
      expect(res.body.data.recentBookings[0].amount).toBe(180);
    });

    it('401 UNAUTHORIZED: Fails when request lacks Authorization Bearer token', async () => {
      const res = await request(app).get('/api/v1/operator/overview');

      logE2EStep({
        scenario: 'Unauthorized access to operator overview without token',
        method: 'GET',
        endpoint: '/api/v1/operator/overview',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.UNAUTHORIZED);
      expect(res.body.success).toBe(false);
    });

    it('403 FORBIDDEN: Blocks non-operator customer user from operator dashboard', async () => {
      const res = await request(app)
        .get('/api/v1/operator/overview')
        .set('Authorization', `Bearer ${customerToken}`);

      logE2EStep({
        scenario: 'Customer user blocked from accessing operator overview',
        method: 'GET',
        endpoint: '/api/v1/operator/overview',
        authRole: 'USER',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.FORBIDDEN);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 2. GET & PATCH /api/v1/operator/settings (COMPANY SETTINGS & BUFFER)
  // =========================================================================
  describe('2. /api/v1/operator/settings (Operator Company Settings)', () => {
    it('200 OK: Retrieves operator profile and company settings', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );

      const res = await request(app)
        .get('/api/v1/operator/settings')
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Retrieve operator company settings',
        method: 'GET',
        endpoint: '/api/v1/operator/settings',
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.companyName).toBe(mockOperatorProfile.companyName);
    });

    it('200 OK: Successfully updates company profile settings', async () => {
      const updatePayload = {
        companyName: 'Island Hop Premium Marine Ltd',
        contactPersonName: 'Captain Ahmed Ali',
        contactEmail: 'contact@islandhop.com',
        businessAddress: 'Terminal 2, Male Harbour',
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.operatorProfile.update).mockResolvedValue({
        ...mockOperatorProfile,
        ...updatePayload,
      } as any);

      const res = await request(app)
        .patch('/api/v1/operator/settings')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(updatePayload);

      logE2EStep({
        scenario: 'Update operator company settings',
        method: 'PATCH',
        endpoint: '/api/v1/operator/settings',
        authRole: 'OPERATOR',
        payload: updatePayload,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.companyName).toBe('Island Hop Premium Marine Ltd');
    });
  });

  // =========================================================================
  // 3. GET /api/v1/operator/manifest (COAST GUARD PASSENGER MANIFEST)
  // =========================================================================
  describe('3. GET /api/v1/operator/manifest (Coast Guard Passenger Manifest)', () => {
    it('200 OK: Retrieves trip roll call with manifest passenger stats', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );

      const validTripId = '11111111-1111-4111-a111-111111111111';
      const mockSchedule = {
        id: validTripId,
        departureTime: new Date('2026-10-20T08:00:00Z'),
        arrivalTime: new Date('2026-10-20T08:45:00Z'),
        gate: 'Gate A',
        captain: 'Captain Ali',
        status: TripStatus.ON_TIME,
        route: {
          id: 'route-1',
          operatorId: mockOperatorProfile.id,
          departurePort: { name: 'Malé Terminal', code: 'MLE' },
          destinationPort: { name: 'Maafushi Pier', code: 'MFU' },
        },
        ferry: {
          id: 'ferry-1',
          name: 'Sea Breeze Catamaran',
          capacity: 60,
        },
      };

      const mockTickets = [
        {
          id: 'tck-101',
          ticketNumber: 'TCK-2026-A',
          passengerName: 'Jane Doe',
          passengerAge: 29,
          passengerGender: 'FEMALE',
          cabinClass: CabinClass.STANDARD,
          seatNumber: 'A1',
          fare: 25,
          boardingStatus: BoardingStatus.BOARDED,
          boardedAt: new Date('2026-10-20T07:50:00Z'),
          luggageCount: 1,
          booking: {
            id: 'bk-1',
            reference: 'FRY-20261020-01',
            contactPhone: '+9609911223',
            emergencyContact: '+9609911224',
          },
        },
      ];

      vi.mocked(prisma.schedule.findUnique).mockResolvedValue(
        mockSchedule as any,
      );
      vi.mocked(prisma.ticket.findMany).mockResolvedValue(mockTickets as any);

      const res = await request(app)
        .get('/api/v1/operator/manifest')
        .query({ tripId: validTripId })
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Retrieve Coast Guard passenger manifest for scheduled trip',
        method: 'GET',
        endpoint: '/api/v1/operator/manifest',
        authRole: 'OPERATOR',
        queryParams: { tripId: validTripId },
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tripInfo.tripId).toBe(validTripId);
      expect(res.body.data.tripInfo.boardedPassengers).toBe(1);
      expect(res.body.data.passengers).toHaveLength(1);
    });

    it('400 BAD REQUEST: Fails when tripId query parameter is omitted', async () => {
      const res = await request(app)
        .get('/api/v1/operator/manifest')
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Reject manifest request without tripId',
        method: 'GET',
        endpoint: '/api/v1/operator/manifest',
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.BAD_REQUEST);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 4. BOARD & UNBOARD PASSENGERS (RAMP CHECK-IN / AUDIT)
  // =========================================================================
  describe('4. Board & Unboard Passenger Ramp Control', () => {
    it('200 OK: Successfully boards passenger with verified luggage count', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );

      const mockTicket = {
        id: 'tck-101',
        boardingStatus: BoardingStatus.CHECKED_IN,
        booking: {
          status: BookingStatus.CONFIRMED,
          schedule: {
            status: TripStatus.ON_TIME,
            route: {
              operatorId: mockOperatorProfile.id,
            },
          },
        },
      };

      vi.mocked(prisma.ticket.findUnique).mockResolvedValue(mockTicket as any);
      vi.mocked(prisma.ticket.update).mockResolvedValue({
        ...mockTicket,
        boardingStatus: BoardingStatus.BOARDED,
        luggageCount: 2,
      } as any);

      const res = await request(app)
        .patch('/api/v1/operator/manifest/tck-101/board')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ luggageCount: 2 });

      logE2EStep({
        scenario: 'Confirm passenger ramp boarding with luggage',
        method: 'PATCH',
        endpoint: '/api/v1/operator/manifest/tck-101/board',
        authRole: 'OPERATOR',
        payload: { luggageCount: 2 },
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.boardingStatus).toBe(BoardingStatus.BOARDED);
    });

    it('200 OK: Reverts passenger boarding status if stepped down before departure', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );

      const mockTicket = {
        id: 'tck-101',
        boardingStatus: BoardingStatus.BOARDED,
        booking: {
          status: BookingStatus.CONFIRMED,
          schedule: {
            status: TripStatus.ON_TIME,
            route: {
              operatorId: mockOperatorProfile.id,
            },
          },
        },
      };

      vi.mocked(prisma.ticket.findUnique).mockResolvedValue(mockTicket as any);
      vi.mocked(prisma.ticket.update).mockResolvedValue({
        ...mockTicket,
        boardingStatus: BoardingStatus.CHECKED_IN,
      } as any);

      const res = await request(app)
        .patch('/api/v1/operator/manifest/tck-101/unboard')
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Revert boarding status when passenger disembarks',
        method: 'PATCH',
        endpoint: '/api/v1/operator/manifest/tck-101/unboard',
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.boardingStatus).toBe(BoardingStatus.CHECKED_IN);
    });
  });

  // =========================================================================
  // 5. GET & PATCH /api/v1/operator/bookings (OPERATOR RESERVATIONS)
  // =========================================================================
  describe('5. /api/v1/operator/bookings (Operator Reservations & Check-in)', () => {
    it('200 OK: Lists bookings for the operator with pagination', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );

      const mockBookings = [
        {
          id: 'bk-001',
          reference: 'FRY-20261020-001',
          leadPassengerName: 'Alex Morgan',
          leadPassengerEmail: 'alex@example.com',
          status: BookingStatus.CONFIRMED,
          totalAmount: 50,
          createdAt: new Date(),
          tickets: [{ id: 'tck-1' }],
          schedule: {
            departureTime: new Date(),
            route: {
              departurePort: { name: 'Malé' },
              destinationPort: { name: 'Hulhumalé' },
            },
            ferry: { name: 'Vessel A' },
          },
        },
      ];

      vi.mocked(prisma.booking.findMany).mockResolvedValue(mockBookings as any);
      vi.mocked(prisma.booking.count).mockResolvedValue(1);

      const res = await request(app)
        .get('/api/v1/operator/bookings')
        .query({ page: 1, limit: 10 })
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'List operator reservations with pagination',
        method: 'GET',
        endpoint: '/api/v1/operator/bookings',
        authRole: 'OPERATOR',
        queryParams: { page: 1, limit: 10 },
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.data).toHaveLength(1);
      expect(res.body.data.meta.total).toBe(1);
    });

    it('200 OK: Marks a customer reservation as checked in', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );

      const mockBooking = {
        id: 'bk-001',
        status: BookingStatus.CONFIRMED,
        schedule: {
          route: {
            operatorId: mockOperatorProfile.id,
          },
        },
      };

      vi.mocked(prisma.booking.findUnique).mockResolvedValue(
        mockBooking as any,
      );
      vi.mocked(prisma.ticket.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.booking.update).mockResolvedValue({
        ...mockBooking,
        status: BookingStatus.CHECKED_IN,
        tickets: [{ id: 'tck-1', boardingStatus: BoardingStatus.CHECKED_IN }],
      } as any);

      const res = await request(app)
        .patch('/api/v1/operator/bookings/bk-001/check-in')
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Check-in confirmed booking at terminal desk',
        method: 'PATCH',
        endpoint: '/api/v1/operator/bookings/bk-001/check-in',
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(BookingStatus.CHECKED_IN);
    });
  });

  // =========================================================================
  // 6. NESTED OPERATOR SUB-ROUTERS (/ferries, /routes)
  // =========================================================================
  describe('6. Operator Nested Sub-Routes Forwarding', () => {
    it('200 OK: Mounts and forwards /api/v1/operator/ferries to FerryRoutes', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.ferry.findMany).mockResolvedValue([
        {
          id: 'ferry-001',
          name: 'Island Cruiser',
          capacity: 100,
          type: VesselType.CATAMARAN,
          status: VesselStatus.IN_SERVICE,
        },
      ] as any);

      const res = await request(app)
        .get('/api/v1/operator/ferries')
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Access nested /api/v1/operator/ferries subroute',
        method: 'GET',
        endpoint: '/api/v1/operator/ferries',
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
    });

    it('404 NOT FOUND: Ensures /api/v1/operator/routes is not mounted (canonical /api/v1/routes is used)', async () => {
      const res = await request(app)
        .get('/api/v1/operator/routes')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(StatusCodes.NOT_FOUND);
    });
  });
});
