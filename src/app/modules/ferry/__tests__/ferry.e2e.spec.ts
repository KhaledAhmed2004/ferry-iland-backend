import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import { VesselStatus, VesselType } from '@prisma/client';
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
    ferry: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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

describe('Ferry Module E2E Test Suite (Core Business Flow - Happy Paths)', () => {
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
    user: {
      id: mockOperatorUser.id,
      status: 'ACTIVE',
    },
  };

  // Bearer Token for Operator
  const operatorToken = jwtHelper.createToken(
    mockOperatorUser,
    jwtSecret,
    '1d',
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ status: 'ACTIVE', deletedAt: null } as never);
  });

  // =========================================================================
  // 1. POST /api/v1/ferries (REGISTER FERRY VESSEL)
  // =========================================================================
  describe('1. POST /api/v1/ferries (Register Vessel)', () => {
    it('201 CREATED: Successfully registers a new ferry vessel with valid payload', async () => {
      const payload = {
        name: 'Island Cruiser One',
        capacity: 150,
        type: VesselType.CATAMARAN,
        status: VesselStatus.IN_SERVICE,
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.ferry.create).mockResolvedValue({
        id: 'ferry-001',
        operatorId: mockOperatorProfile.id,
        ...payload,
        createdAt: new Date('2026-10-15T10:00:00Z'),
        updatedAt: new Date('2026-10-15T10:00:00Z'),
      } as any);

      const res = await request(app)
        .post('/api/v1/ferries')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(payload);

      logE2EStep({
        scenario: 'Register a new valid ferry vessel',
        method: 'POST',
        endpoint: '/api/v1/ferries',
        authRole: 'OPERATOR',
        payload,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.CREATED);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Ferry vessel registered successfully');
      expect(res.body.data).toMatchObject({
        id: 'ferry-001',
        operatorId: mockOperatorProfile.id,
        name: 'Island Cruiser One',
        capacity: 150,
        type: 'CATAMARAN',
        status: 'IN_SERVICE',
      });
    });
  });

  // =========================================================================
  // 2. GET /api/v1/ferries (LIST OPERATOR FERRIES)
  // =========================================================================
  describe('2. GET /api/v1/ferries (List Operator Ferries with Filter & Pagination)', () => {
    it('200 OK: Retrieves paginated list of ferries with meta information and strict ordering', async () => {
      const queryParams = { page: 1, limit: 10 };

      const mockFerriesList = [
        {
          id: 'ferry-001',
          name: 'Island Cruiser One',
          capacity: 150,
          type: VesselType.CATAMARAN,
          status: VesselStatus.IN_SERVICE,
          operatorId: mockOperatorProfile.id,
          createdAt: new Date(),
          _count: { schedules: 4 },
        },
        {
          id: 'ferry-002',
          name: 'Sea Breeze Speedster',
          capacity: 45,
          type: VesselType.SPEEDBOAT,
          status: VesselStatus.MAINTENANCE,
          operatorId: mockOperatorProfile.id,
          createdAt: new Date(),
          _count: { schedules: 0 },
        },
      ];

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.ferry.findMany).mockResolvedValue(
        mockFerriesList as any,
      );
      vi.mocked(prisma.ferry.count).mockResolvedValue(2);

      const res = await request(app)
        .get('/api/v1/ferries')
        .query(queryParams)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'List all ferries under operator profile with pagination',
        method: 'GET',
        endpoint: '/api/v1/ferries',
        authRole: 'OPERATOR',
        queryParams,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Ferries retrieved successfully');
      expect(res.body.data.meta).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.items[0].id).toBe('ferry-001');
      expect(res.body.data.items[0].scheduleCount).toBe(4);

      // Database assertion verifying deterministic ordering and tenant scoping
      expect(prisma.ferry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            operatorId: mockOperatorProfile.id,
          }),
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('200 OK: Applies filters for search, vessel status, and vessel type', async () => {
      const queryParams = {
        search: 'Cruiser',
        status: VesselStatus.IN_SERVICE,
        type: VesselType.CATAMARAN,
        page: 1,
        limit: 5,
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.ferry.findMany).mockResolvedValue([
        {
          id: 'ferry-001',
          name: 'Island Cruiser One',
          capacity: 150,
          type: VesselType.CATAMARAN,
          status: VesselStatus.IN_SERVICE,
          operatorId: mockOperatorProfile.id,
          _count: { schedules: 4 },
        },
      ] as any);
      vi.mocked(prisma.ferry.count).mockResolvedValue(1);

      const res = await request(app)
        .get('/api/v1/ferries')
        .query(queryParams)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario:
          'Filter ferries by status=IN_SERVICE, type=CATAMARAN, and search=Cruiser',
        method: 'GET',
        endpoint: '/api/v1/ferries',
        authRole: 'OPERATOR',
        queryParams,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].name).toBe('Island Cruiser One');
      expect(res.body.data.items[0].scheduleCount).toBe(4);
    });

    it('200 OK: Returns empty array and zero total count when operator has no vessels', async () => {
      const queryParams = { page: 1, limit: 10 };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.ferry.findMany).mockResolvedValue([]);
      vi.mocked(prisma.ferry.count).mockResolvedValue(0);

      const res = await request(app)
        .get('/api/v1/ferries')
        .query(queryParams)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'List ferries returns empty result when no records exist',
        method: 'GET',
        endpoint: '/api/v1/ferries',
        authRole: 'OPERATOR',
        queryParams,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.meta).toEqual({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      expect(res.body.data.items).toEqual([]);
    });

    it('200 OK: Correctly returns hasNextPage=true and hasPreviousPage=false for first page of multi-page results', async () => {
      const queryParams = { page: 1, limit: 2 };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.ferry.findMany).mockResolvedValue([
        {
          id: 'ferry-001',
          name: 'Island Cruiser One',
          capacity: 150,
          type: VesselType.CATAMARAN,
          status: VesselStatus.IN_SERVICE,
          operatorId: mockOperatorProfile.id,
          createdAt: new Date(),
          _count: { schedules: 4 },
        },
        {
          id: 'ferry-002',
          name: 'Sea Breeze Speedster',
          capacity: 45,
          type: VesselType.SPEEDBOAT,
          status: VesselStatus.MAINTENANCE,
          operatorId: mockOperatorProfile.id,
          createdAt: new Date(),
          _count: { schedules: 0 },
        },
      ] as any);
      vi.mocked(prisma.ferry.count).mockResolvedValue(5);

      const res = await request(app)
        .get('/api/v1/ferries')
        .query(queryParams)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario:
          'Multi-page pagination flags: page 1 of 3 (hasNextPage: true, hasPreviousPage: false)',
        method: 'GET',
        endpoint: '/api/v1/ferries',
        authRole: 'OPERATOR',
        queryParams,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.data.meta).toEqual({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: false,
      });
    });
  });

  // =========================================================================
  // 3. GET /api/v1/ferries/stats (FLEET SUMMARY CARDS)
  // =========================================================================
  describe('3. GET /api/v1/ferries/stats (Fleet Summary Statistics Cards)', () => {
    it('200 OK: Retrieves ferry fleet summary statistics for dashboard cards', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.ferry.findMany).mockResolvedValue([
        { status: VesselStatus.IN_SERVICE, capacity: 150 },
        { status: VesselStatus.IN_SERVICE, capacity: 200 },
        { status: VesselStatus.MAINTENANCE, capacity: 200 },
      ] as any);

      const res = await request(app)
        .get('/api/v1/ferries/stats')
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Retrieve ferry fleet summary statistics for dashboard cards',
        method: 'GET',
        endpoint: '/api/v1/ferries/stats',
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe(
        'Ferry fleet statistics retrieved successfully',
      );
      expect(res.body.data).toEqual({
        totalFerries: 3,
        inServiceFerries: 2,
        maintenanceFerries: 1,
        outOfServiceFerries: 0,
        totalCapacity: 550,
      });
    });
  });

  // =========================================================================
  // 4. GET /api/v1/ferries/:id (GET SINGLE FERRY DETAILS)
  // =========================================================================
  describe('4. GET /api/v1/ferries/:id (Get Ferry Details by ID)', () => {
    it('200 OK: Retrieves single ferry vessel details by ID', async () => {
      const ferryId = 'ferry-001';

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue({
        id: ferryId,
        operatorId: mockOperatorProfile.id,
        name: 'Island Cruiser One',
        capacity: 150,
        type: VesselType.CATAMARAN,
        status: VesselStatus.IN_SERVICE,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { schedules: 5 },
      } as any);

      const res = await request(app)
        .get(`/api/v1/ferries/${ferryId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Retrieve single ferry details by ID',
        method: 'GET',
        endpoint: `/api/v1/ferries/${ferryId}`,
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Ferry details retrieved successfully');
      expect(res.body.data.id).toBe(ferryId);
      expect(res.body.data.scheduleCount).toBe(5);
    });
  });

  // =========================================================================
  // 5. PATCH /api/v1/ferries/:id (UPDATE FERRY VESSEL)
  // =========================================================================
  describe('5. PATCH /api/v1/ferries/:id (Update Ferry Details)', () => {
    it('200 OK: Successfully updates vessel capacity, name and status', async () => {
      const ferryId = 'ferry-001';
      const updatePayload = {
        name: 'Island Cruiser Super Express',
        capacity: 180,
        status: VesselStatus.MAINTENANCE,
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue({
        id: ferryId,
        operatorId: mockOperatorProfile.id,
        name: 'Island Cruiser One',
        capacity: 150,
        status: VesselStatus.IN_SERVICE,
      } as any);
      vi.mocked(prisma.ferry.update).mockResolvedValue({
        id: ferryId,
        operatorId: mockOperatorProfile.id,
        ...updatePayload,
      } as any);

      const res = await request(app)
        .patch(`/api/v1/ferries/${ferryId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(updatePayload);

      logE2EStep({
        scenario: 'Update vessel name, capacity and status',
        method: 'PATCH',
        endpoint: `/api/v1/ferries/${ferryId}`,
        authRole: 'OPERATOR',
        payload: updatePayload,
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Ferry vessel updated successfully');
      expect(res.body.data.name).toBe('Island Cruiser Super Express');
      expect(res.body.data.capacity).toBe(180);
      expect(res.body.data.status).toBe('MAINTENANCE');
    });
  });

  // =========================================================================
  // 6. DELETE /api/v1/ferries/:id (DELETE OR DECOMMISSION FERRY)
  // =========================================================================
  describe('6. DELETE /api/v1/ferries/:id (Decommission or Permanent Delete)', () => {
    it('200 OK (Decommission): Sets status to OUT_OF_SERVICE when vessel has linked schedules', async () => {
      const ferryId = 'ferry-with-schedules';

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue({
        id: ferryId,
        operatorId: mockOperatorProfile.id,
        name: 'Active Route Ferry',
        _count: { schedules: 6 },
      } as any);
      vi.mocked(prisma.ferry.update).mockResolvedValue({
        id: ferryId,
        status: VesselStatus.OUT_OF_SERVICE,
      } as any);

      const res = await request(app)
        .delete(`/api/v1/ferries/${ferryId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario:
          'Safe decommission of vessel with linked trips to OUT_OF_SERVICE',
        method: 'DELETE',
        endpoint: `/api/v1/ferries/${ferryId}`,
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain(
        'linked schedules and has been set to OUT_OF_SERVICE',
      );
      expect(res.body.data.status).toBe('OUT_OF_SERVICE');
    });

    it('200 OK (Permanent Delete): Permanently deletes vessel when it has 0 linked schedules', async () => {
      const ferryId = 'ferry-without-schedules';

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperatorProfile as any,
      );
      vi.mocked(prisma.ferry.findUnique).mockResolvedValue({
        id: ferryId,
        operatorId: mockOperatorProfile.id,
        name: 'Idle Standby Ferry',
        _count: { schedules: 0 },
      } as any);
      vi.mocked(prisma.ferry.delete).mockResolvedValue({ id: ferryId } as any);

      const res = await request(app)
        .delete(`/api/v1/ferries/${ferryId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      logE2EStep({
        scenario: 'Permanent deletion of vessel with zero linked schedules',
        method: 'DELETE',
        endpoint: `/api/v1/ferries/${ferryId}`,
        authRole: 'OPERATOR',
        responseStatus: res.status,
        responseBody: res.body,
      });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Vessel permanently deleted');
      expect(res.body.data).toBeNull();
    });
  });
});
