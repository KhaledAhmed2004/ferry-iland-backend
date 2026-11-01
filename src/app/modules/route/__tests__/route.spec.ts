/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { RouteStatus } from '@prisma/client';
import { RouteService } from '../route.service';
import { prisma } from '../../../../shared/prisma';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    operatorProfile: {
      findUnique: vi.fn(),
    },
    port: {
      findUnique: vi.fn(),
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
  },
}));

describe('RouteService Unit Tests', () => {
  const mockOperator = {
    id: 'op-1',
    userId: 'user-op-1',
    companyName: 'Island Hop Express',
  };

  const mockDeparturePort = {
    id: 'port-male',
    name: 'Malé Terminal',
    isActive: true,
  };

  const mockDestinationPort = {
    id: 'port-hulhumale',
    name: 'Hulhumalé Ferry Terminal',
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRoute', () => {
    it('creates a route under operator profile when payload is valid', async () => {
      const payload = {
        departurePortId: 'port-male',
        destinationPortId: 'port-hulhumale',
        durationMinutes: 25,
        isBorderCrossing: false,
        status: RouteStatus.ACTIVE,
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.port.findUnique)
        .mockResolvedValueOnce(mockDeparturePort as any)
        .mockResolvedValueOnce(mockDestinationPort as any);
      vi.mocked(prisma.route.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.route.create).mockResolvedValue({
        id: 'route-1',
        operatorId: mockOperator.id,
        ...payload,
        departurePort: {
          id: mockDeparturePort.id,
          name: mockDeparturePort.name,
        },
        destinationPort: {
          id: mockDestinationPort.id,
          name: mockDestinationPort.name,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await RouteService.createRoute('user-op-1', payload);

      expect(result).toMatchObject({
        id: 'route-1',
        operatorId: 'op-1',
        departurePortId: 'port-male',
        destinationPortId: 'port-hulhumale',
        durationMinutes: 25,
        status: RouteStatus.ACTIVE,
      });
      expect(prisma.route.create).toHaveBeenCalledWith({
        data: {
          operatorId: mockOperator.id,
          departurePortId: payload.departurePortId,
          destinationPortId: payload.destinationPortId,
          durationMinutes: payload.durationMinutes,
          isBorderCrossing: false,
          status: RouteStatus.ACTIVE,
        },
        include: {
          departurePort: {
            select: {
              id: true,
              name: true,
            },
          },
          destinationPort: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });

    it('throws 400 when departurePortId and destinationPortId are identical', async () => {
      await expect(
        RouteService.createRoute('user-op-1', {
          departurePortId: 'port-male',
          destinationPortId: 'port-male',
          durationMinutes: 30,
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.BAD_REQUEST,
        message: 'Departure port and destination port cannot be the same',
      });
    });

    it('throws 403 when user does not have an operator profile', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(null);

      await expect(
        RouteService.createRoute('user-no-op', {
          departurePortId: 'port-male',
          destinationPortId: 'port-hulhumale',
          durationMinutes: 20,
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.FORBIDDEN,
        message: 'Operator profile not found for this user',
      });
    });

    it('throws 404 when departure port is not found or inactive', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.port.findUnique)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockDestinationPort as any);

      await expect(
        RouteService.createRoute('user-op-1', {
          departurePortId: 'port-missing',
          destinationPortId: 'port-hulhumale',
          durationMinutes: 20,
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
        message: 'Departure port not found or inactive: port-missing',
      });
    });

    it('throws 404 when destination port is inactive', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.port.findUnique)
        .mockResolvedValueOnce(mockDeparturePort as any)
        .mockResolvedValueOnce({ ...mockDestinationPort, isActive: false } as any);

      await expect(
        RouteService.createRoute('user-op-1', {
          departurePortId: 'port-male',
          destinationPortId: 'port-hulhumale',
          durationMinutes: 20,
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
        message: 'Destination port not found or inactive: port-hulhumale',
      });
    });

    it('throws 409 when route between these ports already exists for operator', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.port.findUnique)
        .mockResolvedValueOnce(mockDeparturePort as any)
        .mockResolvedValueOnce(mockDestinationPort as any);
      vi.mocked(prisma.route.findUnique).mockResolvedValue({
        id: 'existing-route',
      } as any);

      await expect(
        RouteService.createRoute('user-op-1', {
          departurePortId: 'port-male',
          destinationPortId: 'port-hulhumale',
          durationMinutes: 25,
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.CONFLICT,
        message: 'You already have an active route configured between these ports',
      });
    });
  });

  describe('listOperatorRoutes', () => {
    it('returns operator routes with pagination and filtering', async () => {
      const mockRoutes = [
        {
          id: 'route-1',
          operatorId: 'op-1',
          departurePortId: 'port-male',
          destinationPortId: 'port-hulhumale',
          durationMinutes: 20,
          status: RouteStatus.ACTIVE,
        },
      ];

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.route.count).mockResolvedValue(1);
      vi.mocked(prisma.route.findMany).mockResolvedValue(mockRoutes as any);

      const result = await RouteService.listOperatorRoutes('user-op-1', {
        page: 1,
        limit: 10,
        status: RouteStatus.ACTIVE,
      });

      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        totalItems: 1,
        totalPages: 1,
      });
      expect(result.routes).toHaveLength(1);
      expect(prisma.route.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            operatorId: 'op-1',
            status: RouteStatus.ACTIVE,
          },
          skip: 0,
          take: 10,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('calculates totalPages accurately for multi-page lists', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.route.count).mockResolvedValue(25);
      vi.mocked(prisma.route.findMany).mockResolvedValue([] as any);

      const result = await RouteService.listOperatorRoutes('user-op-1', {
        page: 2,
        limit: 10,
      });

      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        totalItems: 25,
        totalPages: 3,
      });
    });
  });

  describe('getRouteById', () => {
    it('returns route details when owned by operator', async () => {
      const mockRoute = {
        id: 'route-1',
        operatorId: 'op-1',
        departurePortId: 'port-male',
        destinationPortId: 'port-hulhumale',
        durationMinutes: 25,
        status: RouteStatus.ACTIVE,
        departurePort: mockDeparturePort,
        destinationPort: mockDestinationPort,
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.route.findFirst).mockResolvedValue(mockRoute as any);

      const result = await RouteService.getRouteById('user-op-1', 'route-1');

      expect(result).toMatchObject(mockRoute);
      expect(prisma.route.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'route-1',
          operatorId: 'op-1',
        },
        include: expect.any(Object),
      });
    });

    it('throws 404 when route does not exist or belongs to another operator', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.route.findFirst).mockResolvedValue(null);

      await expect(
        RouteService.getRouteById('user-op-1', 'route-missing'),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
        message: 'Route not found with ID: route-missing',
      });
    });
  });

  describe('updateRoute', () => {
    it('updates route details successfully', async () => {
      const existingRoute = {
        id: 'route-1',
        operatorId: 'op-1',
        durationMinutes: 20,
        status: RouteStatus.ACTIVE,
      };
      const updatedRoute = {
        ...existingRoute,
        durationMinutes: 30,
        status: RouteStatus.INACTIVE,
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.route.findFirst).mockResolvedValue(existingRoute as any);
      vi.mocked(prisma.route.update).mockResolvedValue(updatedRoute as any);

      const result = await RouteService.updateRoute('user-op-1', 'route-1', {
        durationMinutes: 30,
        status: RouteStatus.INACTIVE,
      });

      expect(result).toEqual(updatedRoute);
      expect(prisma.route.update).toHaveBeenCalledWith({
        where: { id: 'route-1' },
        data: {
          durationMinutes: 30,
          status: RouteStatus.INACTIVE,
        },
        include: expect.any(Object),
      });
    });

    it('throws 404 if route to update does not exist', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.route.findFirst).mockResolvedValue(null);

      await expect(
        RouteService.updateRoute('user-op-1', 'route-999', {
          durationMinutes: 45,
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
        message: 'Route not found with ID: route-999',
      });
    });
  });

  describe('deleteRoute', () => {
    it('permanently deletes route when owned by operator', async () => {
      const existingRoute = {
        id: 'route-1',
        operatorId: 'op-1',
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.route.findFirst).mockResolvedValue(existingRoute as any);
      vi.mocked(prisma.route.delete).mockResolvedValue(existingRoute as any);

      const result = await RouteService.deleteRoute('user-op-1', 'route-1');

      expect(result).toEqual({
        success: true,
        message: 'Route deleted successfully',
      });
      expect(prisma.route.delete).toHaveBeenCalledWith({
        where: { id: 'route-1' },
      });
    });

    it('throws 404 when route to delete is not found', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.route.findFirst).mockResolvedValue(null);

      await expect(
        RouteService.deleteRoute('user-op-1', 'route-missing'),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
        message: 'Route not found with ID: route-missing',
      });
    });
  });

  describe('getPublicConnectedPorts', () => {
    it('returns grouped and mapped active connected ports with destination lists', async () => {
      const activeRoutes = [
        {
          departurePort: {
            id: 'port-1',
            name: 'Port Male',
          },
          destinationPort: {
            id: 'port-2',
            name: 'Port Hulhumale',
          },
        },
        {
          departurePort: {
            id: 'port-1',
            name: 'Port Male',
          },
          destinationPort: {
            id: 'port-3',
            name: 'Port Maafushi',
          },
        },
      ];

      vi.mocked(prisma.route.findMany).mockResolvedValue(activeRoutes as any);

      const result = await RouteService.getPublicConnectedPorts();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        portId: 'port-1',
        portName: 'Port Male',
        destinations: [
          {
            portId: 'port-2',
            portName: 'Port Hulhumale',
          },
          {
            portId: 'port-3',
            portName: 'Port Maafushi',
          },
        ],
      });
    });
  });
});
