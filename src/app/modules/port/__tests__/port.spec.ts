import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { PortService } from '../port.service';
import { prisma } from '../../../../shared/prisma';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    port: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    schedule: {
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('PortService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createPort', () => {
    it('creates a port when payload is valid', async () => {
      const payload = {
        name: 'Malé Terminal',
        timeZone: 'America/Anguilla',
        isActive: true,
      };

      vi.mocked(prisma.port.create).mockResolvedValue({
        id: 'port-1',
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await PortService.createPort(payload);

      expect(result).toMatchObject({
        id: 'port-1',
        name: 'Malé Terminal',
      });
      expect(prisma.port.create).toHaveBeenCalledWith({
        data: payload,
      });
    });
  });

  describe('listPorts', () => {
    it('returns paginated ports with meta', async () => {
      const mockPorts = [
        { id: 'port-1', name: 'Malé', isActive: true },
        { id: 'port-2', name: 'Maafushi', isActive: true },
      ];

      vi.mocked(prisma.port.findMany).mockResolvedValue(mockPorts as any);
      vi.mocked(prisma.port.count).mockResolvedValue(2);

      const result = await PortService.listPorts({
        page: 1,
        limit: 10,
        isActive: true,
      });

      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
    });

    it('applies search filters across name', async () => {
      vi.mocked(prisma.port.findMany).mockResolvedValue([]);
      vi.mocked(prisma.port.count).mockResolvedValue(0);

      await PortService.listPorts({ search: 'male' });

      expect(prisma.port.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: { contains: 'male', mode: 'insensitive' },
          }),
        }),
      );
    });
  });

  describe('getPortById', () => {
    it('returns port by id when found', async () => {
      const mockPort = { id: 'port-1', name: 'Malé' };
      vi.mocked(prisma.port.findUnique).mockResolvedValue(mockPort as any);

      const result = await PortService.getPortById('port-1');
      expect(result).toEqual(mockPort);
    });

    it('throws 404 when port does not exist', async () => {
      vi.mocked(prisma.port.findUnique).mockResolvedValue(null);

      await expect(PortService.getPortById('missing-port')).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
        message: 'Port not found',
      });
    });
  });

  describe('updatePort', () => {
    it('updates port details successfully', async () => {
      const existingPort = { id: 'port-1', name: 'Old' };
      const updatedPort = { id: 'port-1', name: 'New' };

      vi.mocked(prisma.port.findUnique).mockResolvedValue(existingPort as any);
      vi.mocked(prisma.port.update).mockResolvedValue(updatedPort as any);

      const result = await PortService.updatePort('port-1', {
        name: 'New',
      });

      expect(result).toEqual(updatedPort);
      expect(prisma.port.update).toHaveBeenCalledWith({
        where: { id: 'port-1' },
        data: { name: 'New' },
      });
    });

    describe('time zone change (spec 0003, AC-11)', () => {
      const existingPort = { id: 'port-1', name: 'Blowing Point', timeZone: 'America/Anguilla' };

      beforeEach(() => {
        vi.mocked(prisma.port.findUnique).mockResolvedValue(existingPort as any);
        vi.mocked(prisma.$transaction).mockImplementation(((fn: any) => fn(prisma)) as any);
        vi.mocked(prisma.port.update).mockImplementation((async (args: any) => ({
          ...existingPort,
          ...args.data,
        })) as any);
      });

      it('treats the same zone as stored as a no op success', async () => {
        await PortService.updatePort('port-1', { timeZone: 'America/Anguilla' });
        expect(prisma.schedule.count).not.toHaveBeenCalled();
        expect(prisma.port.update).toHaveBeenCalled();
      });

      it('returns 409 with the count while future trips use the port', async () => {
        vi.mocked(prisma.schedule.count).mockResolvedValue(1);

        await expect(
          PortService.updatePort('port-1', { timeZone: 'America/St_Kitts' }),
        ).rejects.toMatchObject({
          statusCode: StatusCodes.CONFLICT,
          message: 'Cannot change time zone: 1 upcoming trip depart from or arrive at this port',
          data: { field: 'timeZone', upcomingTrips: 1 },
        });
        expect(prisma.port.update).not.toHaveBeenCalled();

        const where = vi.mocked(prisma.schedule.count).mock.calls[0][0]!.where as any;
        expect(where.status).toEqual({ not: 'CANCELLED' });
        expect(where.route.OR).toEqual([
          { departurePortId: 'port-1' },
          { destinationPortId: 'port-1' },
        ]);
      });

      it('changes the zone when no future trips use the port', async () => {
        vi.mocked(prisma.schedule.count).mockResolvedValue(0);

        const result = await PortService.updatePort('port-1', { timeZone: 'America/St_Kitts' });

        expect(result).toMatchObject({ timeZone: 'America/St_Kitts' });
      });

      it('rejects an invalid zone with 400', async () => {
        await expect(
          PortService.updatePort('port-1', { timeZone: 'Mars/Olympus' }),
        ).rejects.toMatchObject({ statusCode: StatusCodes.BAD_REQUEST });
      });
    });
  });

  describe('deletePort', () => {
    it('deactivates port if routes are connected to it', async () => {
      const portWithRoutes = {
        id: 'port-1',
        name: 'Busy Port',
        _count: { departureRoutes: 2, destinationRoutes: 1 },
      };
      const deactivatedPort = { id: 'port-1', isActive: false };

      vi.mocked(prisma.port.findUnique).mockResolvedValue(portWithRoutes as any);
      vi.mocked(prisma.port.update).mockResolvedValue(deactivatedPort as any);

      const result = await PortService.deletePort('port-1');

      expect(result.deactivated).toBe(true);
      expect(result.message).toContain('deactivated instead of deleted');
      expect(prisma.port.update).toHaveBeenCalledWith({
        where: { id: 'port-1' },
        data: { isActive: false },
      });
      expect(prisma.port.delete).not.toHaveBeenCalled();
    });

    it('deletes port permanently if no routes are connected', async () => {
      const unusedPort = {
        id: 'port-2',
        name: 'Unused Port',
        _count: { departureRoutes: 0, destinationRoutes: 0 },
      };

      vi.mocked(prisma.port.findUnique).mockResolvedValue(unusedPort as any);
      vi.mocked(prisma.port.delete).mockResolvedValue(unusedPort as any);

      const result = await PortService.deletePort('port-2');

      expect(result.deactivated).toBe(false);
      expect(result.message).toBe('Port permanently deleted');
      expect(prisma.port.delete).toHaveBeenCalledWith({
        where: { id: 'port-2' },
      });
    });

    it('throws 404 if port does not exist', async () => {
      vi.mocked(prisma.port.findUnique).mockResolvedValue(null);

      await expect(PortService.deletePort('missing')).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
      });
    });
  });
});
