/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import { RouteStatus } from '@prisma/client';
import app from '../../../../app';
import config from '../../../../config';
import { jwtHelper } from '../../../../helpers/jwtHelper';
import { USER_ROLES, ACCOUNT_STATE } from '../../../../enums/user';
import { prisma } from '../../../../shared/prisma';

// Mock Prisma so that E2E tests execute deterministically against the Express application stack
vi.mock('../../../../shared/prisma', () => {
  const mockPrisma = {
    // Read by the auth middleware on every authenticated request
    user: {
      findUnique: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
    },
    operatorProfile: {
      findUnique: vi.fn(),
    },
    port: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    route: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  return {
    prisma: mockPrisma,
    default: mockPrisma,
  };
});

// Structured Logger for E2E Test execution to display payloads and responses clearly
type ITestLogDetails = {
  scenario: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  endpoint: string;
  authRole?: string;
  queryParams?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  responseStatus: number;
  responseBody: unknown;
};

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

describe('Route Module E2E Test Suite (Core Business Flow - Happy & Negative Paths)', () => {
  const jwtSecret = (config.jwt.jwt_secret || 'jwt_secret') as string;
  if (!config.jwt.jwt_secret) {
    config.jwt.jwt_secret = jwtSecret;
  }

  // Operator User & Profile
  const mockOperatorUser = {
    id: 'user-operator-201',
    email: 'operator@islandhop.com',
    role: USER_ROLES.OPERATOR,
    accountState: ACCOUNT_STATE.VERIFIED,
    status: 'ACTIVE',
  };

  const mockOperatorProfile = {
    id: 'op-profile-601',
    userId: mockOperatorUser.id,
    companyName: 'Island Hop Express Ferry Ltd',
    user: {
      id: mockOperatorUser.id,
      status: 'ACTIVE',
    },
  };

  // Regular Passenger / Customer User
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

  const mockDeparturePort = {
    id: 'port-male-01',
    name: 'Malé Ferry Terminal',
    isActive: true,
  };

  const mockDestinationPort = {
    id: 'port-hulhumale-02',
    name: 'Hulhumalé Ferry Terminal',
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ status: 'ACTIVE', deletedAt: null } as never);
  });

  // =========================================================================
  // 1. POST /api/v1/routes (CREATE FERRY ROUTE)
  // =========================================================================
  describe('1. POST /api/v1/routes (Create Route)', () => {
    it('201 CREATED: Successfully creates a new ferry route with valid payload', async () => {
      const payload = {
        departurePortId: mockDeparturePort.id,
        destinationPortId: mockDestinationPort.id,
        durationMinutes: 25,
        description: 'Scenic speed ferry route connecting Malé and Maafushi',
        imageUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5',
        isBorderCrossing: false,
        status: RouteStatus.ACTIVE,
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.port.findUnique)
        .mockResolvedValueOnce(mockDeparturePort as any)
        .mockResolvedValueOnce(mockDestinationPort as any);
      vi.mocked(prisma.route.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.route.create).mockResolvedValue({
        id: 'route-001',
        operatorId: mockOperatorProfile.id,
        ...payload,
        departurePort: {
          id: mockDeparturePort.id,
          name: mockDeparturePort.name,
        },
        destinationPort: {
          id: mockDestinationPort.id,
          name: mockDestinationPort.name,
        },
        createdAt: new Date('2026-10-17T10:00:00Z'),
        updatedAt: new Date('2026-10-17T10:00:00Z'),
      } as any);

      const res = await request(app)
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(payload);

      logE2EStep({
        scenario: 'Create a new valid ferry route',
        method: 'POST',
        endpoint: '/api/v1/routes',
        authRole: 'OPERATOR',
        payload,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.CREATED);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Route created successfully');
      expect(res.body.data).toMatchObject({
        id: 'route-001',
        operatorId: mockOperatorProfile.id,
        departurePortId: mockDeparturePort.id,
        destinationPortId: mockDestinationPort.id,
        durationMinutes: 25,
        status: 'ACTIVE',
      });
    });

    it('400 BAD REQUEST: Fails when departure and destination ports are the same', async () => {
      const payload = {
        departurePortId: mockDeparturePort.id,
        destinationPortId: mockDeparturePort.id,
        durationMinutes: 25,
        description: 'Scenic speed ferry route connecting Malé and Maafushi',
        imageUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5',
      };

      const res = await request(app)
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(payload);

      logE2EStep({
        scenario: 'Validation rejection when departure and destination ports match',
        method: 'POST',
        endpoint: '/api/v1/routes',
        authRole: 'OPERATOR',
        payload,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.BAD_REQUEST);
      expect(res.body.success).toBe(false);
    });

    it('401 UNAUTHORIZED: Fails when Authorization token is missing', async () => {
      const payload = {
        departurePortId: mockDeparturePort.id,
        destinationPortId: mockDestinationPort.id,
        durationMinutes: 25,
        description: 'Scenic speed ferry route connecting Malé and Maafushi',
        imageUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5',
      };

      const res = await request(app)
        .post('/api/v1/routes')
        .send(payload);

      logE2EStep({
        scenario: 'Missing bearer token returns unauthorized error',
        method: 'POST',
        endpoint: '/api/v1/routes',
        payload,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.UNAUTHORIZED);
      expect(res.body.success).toBe(false);
    });

    it('403 FORBIDDEN: Rejects user with role USER from creating routes', async () => {
      const payload = {
        departurePortId: mockDeparturePort.id,
        destinationPortId: mockDestinationPort.id,
        durationMinutes: 25,
        description: 'Scenic speed ferry route connecting Malé and Maafushi',
        imageUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5',
      };

      const res = await request(app)
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(payload);

      logE2EStep({
        scenario: 'Passenger role forbidden from route creation',
        method: 'POST',
        endpoint: '/api/v1/routes',
        authRole: 'USER',
        payload,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.FORBIDDEN);
      expect(res.body.success).toBe(false);
    });

    it('404 NOT FOUND: Returns error when departure port does not exist or is inactive', async () => {
      const payload = {
        departurePortId: 'non-existent-port',
        destinationPortId: mockDestinationPort.id,
        durationMinutes: 30,
        description: 'Scenic speed ferry route connecting Malé and Maafushi',
        imageUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5',
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.port.findUnique)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockDestinationPort as any);

      const res = await request(app)
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(payload);

      logE2EStep({
        scenario: 'Non-existent departure port returns 404',
        method: 'POST',
        endpoint: '/api/v1/routes',
        authRole: 'OPERATOR',
        payload,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.NOT_FOUND);
      expect(res.body.success).toBe(false);
    });

    it('409 CONFLICT: Returns error when active route between ports already exists', async () => {
      const payload = {
        departurePortId: mockDeparturePort.id,
        destinationPortId: mockDestinationPort.id,
        durationMinutes: 25,
        description: 'Scenic speed ferry route connecting Malé and Maafushi',
        imageUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5',
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.port.findUnique)
        .mockResolvedValueOnce(mockDeparturePort as any)
        .mockResolvedValueOnce(mockDestinationPort as any);
      vi.mocked(prisma.route.findUnique).mockResolvedValue({
        id: 'existing-route-001',
      } as any);

      const res = await request(app)
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(payload);

      logE2EStep({
        scenario: 'Duplicate route returns 409 conflict',
        method: 'POST',
        endpoint: '/api/v1/routes',
        authRole: 'OPERATOR',
        payload,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.CONFLICT);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('already have an active route');
    });

    it('400 BAD REQUEST: Fails when imageUrl is missing', async () => {
      const payload = {
        departurePortId: mockDeparturePort.id,
        destinationPortId: mockDestinationPort.id,
        durationMinutes: 25,
      };

      const res = await request(app)
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(payload);

      expect(res.status).toBe(StatusCodes.BAD_REQUEST);
      expect(res.body.success).toBe(false);
    });

    it('400 BAD REQUEST: Fails when description is missing', async () => {
      const payload = {
        departurePortId: mockDeparturePort.id,
        destinationPortId: mockDestinationPort.id,
        durationMinutes: 25,
        imageUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5',
      };

      const res = await request(app)
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(payload);

      expect(res.status).toBe(StatusCodes.BAD_REQUEST);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 2. GET /api/v1/routes (LIST OPERATOR ROUTES)
  // =========================================================================
  describe('2. GET /api/v1/routes (List Operator Routes with Filter & Pagination)', () => {
    it('200 OK: Retrieves paginated list of routes with pagination metadata', async () => {
      const queryParams = { page: 1, limit: 10 };

      const mockRoutesList = [
        {
          id: 'route-001',
          operatorId: mockOperatorProfile.id,
          departurePortId: mockDeparturePort.id,
          destinationPortId: mockDestinationPort.id,
          durationMinutes: 25,
          isBorderCrossing: false,
          status: RouteStatus.ACTIVE,
          departurePort: mockDeparturePort,
          destinationPort: mockDestinationPort,
        },
      ];

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.route.count).mockResolvedValue(1);
      vi.mocked(prisma.route.findMany).mockResolvedValue(mockRoutesList as any);

      const res = await request(app)
        .get('/api/v1/routes')
        .query(queryParams)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'List operator routes with pagination',
        method: 'GET',
        endpoint: '/api/v1/routes',
        authRole: 'OPERATOR',
        queryParams,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Routes retrieved successfully');
      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 10,
        totalItems: 1,
        totalPages: 1,
      });
      expect(res.body.data.routes).toHaveLength(1);
      expect(res.body.data.routes[0].id).toBe('route-001');
    });

    it('200 OK: Filters routes by status query parameter', async () => {
      const queryParams = { status: RouteStatus.ACTIVE };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.route.count).mockResolvedValue(1);
      vi.mocked(prisma.route.findMany).mockResolvedValue([
        {
          id: 'route-001',
          operatorId: mockOperatorProfile.id,
          status: RouteStatus.ACTIVE,
        },
      ] as any);

      const res = await request(app)
        .get('/api/v1/routes')
        .query(queryParams)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Filter routes by status ACTIVE',
        method: 'GET',
        endpoint: '/api/v1/routes',
        authRole: 'OPERATOR',
        queryParams,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(prisma.route.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            operatorId: mockOperatorProfile.id,
            status: RouteStatus.ACTIVE,
          }),
        }),
      );
    });
  });

  // =========================================================================
  // 3. GET /api/v1/routes/:id (GET ROUTE DETAILS BY ID)
  // =========================================================================
  describe('3. GET /api/v1/routes/:id (Get Route Details by ID)', () => {
    it('200 OK: Retrieves single route details by ID', async () => {
      const routeId = 'route-001';
      const mockRoute = {
        id: routeId,
        operatorId: mockOperatorProfile.id,
        departurePortId: mockDeparturePort.id,
        destinationPortId: mockDestinationPort.id,
        durationMinutes: 25,
        status: RouteStatus.ACTIVE,
        departurePort: mockDeparturePort,
        destinationPort: mockDestinationPort,
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.route.findFirst).mockResolvedValue(mockRoute as any);

      const res = await request(app)
        .get(`/api/v1/routes/${routeId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Retrieve single route details by ID',
        method: 'GET',
        endpoint: `/api/v1/routes/${routeId}`,
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Route retrieved successfully');
      expect(res.body.data.id).toBe(routeId);
    });

    it('404 NOT FOUND: Returns 404 when route does not exist', async () => {
      const routeId = 'route-missing';

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.route.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/v1/routes/${routeId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Non-existent route ID returns 404',
        method: 'GET',
        endpoint: `/api/v1/routes/${routeId}`,
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.NOT_FOUND);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 4. PATCH /api/v1/routes/:id (UPDATE ROUTE)
  // =========================================================================
  describe('4. PATCH /api/v1/routes/:id (Update Route Details)', () => {
    it('200 OK: Successfully updates route duration and status', async () => {
      const routeId = 'route-001';
      const updatePayload = {
        durationMinutes: 35,
        status: RouteStatus.INACTIVE,
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.route.findFirst).mockResolvedValue({
        id: routeId,
        operatorId: mockOperatorProfile.id,
      } as any);
      vi.mocked(prisma.route.update).mockResolvedValue({
        id: routeId,
        operatorId: mockOperatorProfile.id,
        durationMinutes: 35,
        status: RouteStatus.INACTIVE,
      } as any);

      const res = await request(app)
        .patch(`/api/v1/routes/${routeId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(updatePayload);

      logE2EStep({
        scenario: 'Update route duration and status',
        method: 'PATCH',
        endpoint: `/api/v1/routes/${routeId}`,
        authRole: 'OPERATOR',
        payload: updatePayload,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Route updated successfully');
      expect(res.body.data.durationMinutes).toBe(35);
      expect(res.body.data.status).toBe('INACTIVE');
    });

    it('404 NOT FOUND: Returns 404 when updating non-existent route', async () => {
      const routeId = 'route-missing';
      const updatePayload = { durationMinutes: 40 };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.route.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .patch(`/api/v1/routes/${routeId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(updatePayload);

      logE2EStep({
        scenario: 'Updating non-existent route returns 404',
        method: 'PATCH',
        endpoint: `/api/v1/routes/${routeId}`,
        authRole: 'OPERATOR',
        payload: updatePayload,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.NOT_FOUND);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 5. DELETE /api/v1/routes/:id (DELETE ROUTE)
  // =========================================================================
  describe('5. DELETE /api/v1/routes/:id (Delete Route)', () => {
    it('200 OK: Successfully deletes route', async () => {
      const routeId = 'route-001';

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.route.findFirst).mockResolvedValue({
        id: routeId,
        operatorId: mockOperatorProfile.id,
      } as any);
      vi.mocked(prisma.route.delete).mockResolvedValue({ id: routeId } as any);

      const res = await request(app)
        .delete(`/api/v1/routes/${routeId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Permanent deletion of route',
        method: 'DELETE',
        endpoint: `/api/v1/routes/${routeId}`,
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Route deleted successfully');
      expect(res.body.data).toBeNull();
    });

    it('404 NOT FOUND: Returns 404 when route to delete does not exist', async () => {
      const routeId = 'route-missing';

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.route.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .delete(`/api/v1/routes/${routeId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Deleting non-existent route returns 404',
        method: 'DELETE',
        endpoint: `/api/v1/routes/${routeId}`,
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.NOT_FOUND);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 5b. BULK OPERATIONS (PATCH /api/v1/routes/bulk-status & POST /api/v1/routes/bulk-delete)
  // =========================================================================
  describe('5b. Bulk Route Operations', () => {
    it('200 OK: Successfully updates multiple route statuses', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.route.updateMany).mockResolvedValue({ count: 2 });

      const res = await request(app)
        .patch('/api/v1/routes/bulk-status')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          ids: ['route-001', 'route-002'],
          status: 'INACTIVE',
        });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(2);
    });

    it('200 OK: Successfully deletes multiple routes', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.route.findMany).mockResolvedValue([]);
      vi.mocked(prisma.route.deleteMany).mockResolvedValue({ count: 2 });

      const res = await request(app)
        .post('/api/v1/routes/bulk-delete')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          ids: ['route-001', 'route-002'],
        });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(2);
    });

    it('200 OK: Partially deletes routes without bookings while preserving routes with active bookings', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      // route-001 has bookings, route-002 does not
      vi.mocked(prisma.route.findMany).mockResolvedValue([
        {
          id: 'route-001',
          departurePort: { name: 'Malé Terminal' },
          destinationPort: { name: 'Maafushi Jetty' },
        },
      ] as any);
      vi.mocked(prisma.route.deleteMany).mockResolvedValue({ count: 1 });

      const res = await request(app)
        .post('/api/v1/routes/bulk-delete')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          ids: ['route-001', 'route-002'],
        });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(1);
      expect(res.body.data.skippedCount).toBe(1);
      expect(res.body.data.skippedRoutes).toEqual(['"Malé Terminal ➔ Maafushi Jetty"']);
      expect(res.body.message).toContain('Deleted 1 routes');
      expect(res.body.message).toContain('skipped because of active passenger bookings');
    });

    it('409 CONFLICT: Rejects bulk delete when ALL selected routes have active bookings', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.route.findMany).mockResolvedValue([
        {
          id: 'route-001',
          departurePort: { name: 'Malé Terminal' },
          destinationPort: { name: 'Maafushi Jetty' },
        },
      ] as any);

      const res = await request(app)
        .post('/api/v1/routes/bulk-delete')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          ids: ['route-001'],
        });

      expect(res.status).toBe(StatusCodes.CONFLICT);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('existing passenger bookings attached');
    });

    it('400 BAD REQUEST: Fails bulk operation when ids array is empty', async () => {
      const res = await request(app)
        .patch('/api/v1/routes/bulk-status')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          ids: [],
          status: 'ACTIVE',
        });

      expect(res.status).toBe(StatusCodes.BAD_REQUEST);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 6. GET /api/v1/routes/ports (PUBLIC CONNECTED PORTS)
  // =========================================================================
  describe('6. GET /api/v1/routes/ports (Public Connected Ports Map)', () => {
    it('200 OK: Public unauthenticated request returns connected ports mapping', async () => {
      const mockActiveRoutes = [
        {
          departurePort: {
            id: 'port-male',
            name: 'Malé Terminal',
          },
          destinationPort: {
            id: 'port-hulhumale',
            name: 'Hulhumalé Ferry Terminal',
          },
        },
      ];

      vi.mocked(prisma.route.findMany).mockResolvedValue(mockActiveRoutes as any);

      const res = await request(app).get('/api/v1/routes/ports');

      logE2EStep({
        scenario: 'Retrieve public connected ports without authentication',
        method: 'GET',
        endpoint: '/api/v1/routes/ports',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Connected ports retrieved successfully');
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].portId).toBe('port-male');
      expect(res.body.data[0].destinations).toHaveLength(1);
      expect(res.body.data[0].destinations[0].portId).toBe('port-hulhumale');
    });
  });

  // =========================================================================
  // 7. GET /api/v1/routes/popular (PUBLIC POPULAR JOURNEYS)
  // =========================================================================
  describe('7. GET /api/v1/routes/popular (Public Popular Journeys Catalog)', () => {
    const mockPopularRoutes = [
      {
        id: 'route-001',
        durationMinutes: 35,
        departurePort: {
          id: 'port-male',
          name: 'Malé Ferry Terminal',
          code: 'MLE',
        },
        destinationPort: {
          id: 'port-maafushi',
          name: 'Maafushi Harbor',
          code: 'MAF',
        },
        operator: {
          id: 'op-001',
          companyName: 'Maldives Speed Ferries',
          contactEmail: 'contact@msf.mv',
        },
        schedules: [
          {
            id: 'sched-001',
            adultFare: 30,
            childFare: 15,
            availableSeats: 50,
            departureTime: new Date(),
            _count: { bookings: 25 },
          },
          {
            id: 'sched-002',
            adultFare: 35,
            childFare: 20,
            availableSeats: 40,
            departureTime: new Date(),
            _count: { bookings: 15 },
          },
        ],
        _count: { schedules: 6 },
      },
      {
        id: 'route-002',
        durationMinutes: 45,
        departurePort: {
          id: 'port-male',
          name: 'Malé Ferry Terminal',
          code: 'MLE',
        },
        destinationPort: {
          id: 'port-thulusdhoo',
          name: 'Thulusdhoo Harbor',
          code: 'THU',
        },
        operator: {
          id: 'op-002',
          companyName: 'Island Express Lines',
          contactEmail: 'contact@iel.mv',
        },
        schedules: [
          {
            id: 'sched-003',
            adultFare: 30,
            childFare: 15,
            availableSeats: 30,
            departureTime: new Date(),
            _count: { bookings: 10 },
          },
        ],
        _count: { schedules: 4 },
      },
    ];

    it('200 OK: Public unauthenticated request returns popular journeys with correct profiles', async () => {
      vi.mocked(prisma.route.findMany).mockResolvedValue(mockPopularRoutes as any);

      const res = await request(app).get('/api/v1/routes/popular');

      logE2EStep({
        scenario: 'Retrieve popular routes without authentication',
        method: 'GET',
        endpoint: '/api/v1/routes/popular',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Popular routes retrieved successfully');
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data).toHaveLength(2);

      const firstJourney = res.body.data[0];
      expect(firstJourney.from).toBe('Malé Ferry Terminal');
      expect(firstJourney.to).toBe('Maafushi Harbor');
      expect(firstJourney.tag).toBe('Most Popular');
      expect(firstJourney.tagColor).toBe('bg-blue-600 text-white');
      expect(firstJourney.startingPrice).toBe(30);
      expect(firstJourney.category).toBe('speedboat');
      expect(firstJourney.totalBookings).toBe(40);
      expect(firstJourney.operatorName).toBe('Maldives Speed Ferries');

      const secondJourney = res.body.data[1];
      expect(secondJourney.from).toBe('Malé Ferry Terminal');
      expect(secondJourney.to).toBe('Thulusdhoo Harbor');
      expect(secondJourney.tag).toBeNull();
      expect(secondJourney.tagColor).toBeNull();
    });

    it('200 OK: Respects limit parameter and filters by category', async () => {
      vi.mocked(prisma.route.findMany).mockResolvedValue(mockPopularRoutes as any);

      const res = await request(app)
        .get('/api/v1/routes/popular')
        .query({ limit: 1, category: 'speedboat' });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].category).toBe('speedboat');
    });
  });
});

