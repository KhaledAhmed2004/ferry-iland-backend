import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { BookingStatus, BoardingStatus, CabinClass, TripStatus } from '@prisma/client';
import { TicketService } from '../ticket.service';
import { prisma } from '../../../../shared/prisma';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    operatorProfile: {
      findUnique: vi.fn(),
    },
    schedule: {
      findUnique: vi.fn(),
    },
    ticket: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('TicketService Unit Tests', () => {
  const mockOperator = { id: 'op-1', userId: 'user-op-1' };

  const mockSchedule = {
    id: 'trip-1',
    captain: 'Capt. Mark Kealoha',
    departureTime: new Date('2026-10-20T08:30:00.000Z'),
    arrivalTime: new Date('2026-10-20T09:15:00.000Z'),
    status: TripStatus.BOARDING,
    route: {
      operatorId: 'op-1',
      departurePort: { name: 'Honolulu Harbor Pier 4' },
      destinationPort: { name: 'Kahului Harbor, Maui' },
    },
    ferry: { name: 'Ocean Voyager I' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTripManifest', () => {
    it('returns Coast Guard manifest with roll-call counters', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.schedule.findUnique).mockResolvedValue(
        mockSchedule as any,
      );

      const mockTickets = [
        {
          id: 'tck-1',
          ticketNumber: 'TCK-88210-A',
          passengerName: 'Michael Chang',
          nationality: 'USA',
          passportOrId: 'P-8829104',
          cabinClass: CabinClass.VIP,
          luggageCount: 2,
          boardingStatus: BoardingStatus.BOARDED,
          boardedAt: new Date('2026-10-20T08:15:00.000Z'),
          booking: { reference: 'FRY-20261020-001A' },
        },
        {
          id: 'tck-2',
          ticketNumber: 'TCK-88210-B',
          passengerName: 'Sarah Chang',
          nationality: 'USA',
          passportOrId: 'P-8829105',
          cabinClass: CabinClass.VIP,
          luggageCount: 1,
          boardingStatus: BoardingStatus.PENDING,
          boardedAt: null,
          booking: { reference: 'FRY-20261020-001A' },
        },
      ];

      vi.mocked(prisma.ticket.findMany).mockResolvedValue(mockTickets as any);

      const result = await TicketService.getTripManifest(
        'user-op-1',
        'trip-1',
      );

      expect(result.tripInfo).toMatchObject({
        tripId: 'trip-1',
        vesselName: 'Ocean Voyager I',
        captain: 'Capt. Mark Kealoha',
        totalPassengers: 2,
        boardedPassengers: 1,
      });
      expect(result.passengers).toHaveLength(2);
      expect(result.passengers[0].passengerName).toBe('Michael Chang');
    });

    it('throws 404 when schedule is missing or belongs to another operator', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.schedule.findUnique).mockResolvedValue(null);

      await expect(
        TicketService.getTripManifest('user-op-1', 'non-existing-trip'),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
      });
    });
  });

  describe('boardPassenger', () => {
    it('marks passenger as BOARDED onto vessel ramp', async () => {
      const mockTicket = {
        id: 'tck-1',
        booking: {
          status: BookingStatus.CONFIRMED,
          schedule: {
            status: TripStatus.BOARDING,
            route: { operatorId: 'op-1' },
          },
        },
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ticket.findUnique).mockResolvedValue(mockTicket as any);
      vi.mocked(prisma.ticket.update).mockResolvedValue({
        id: 'tck-1',
        boardingStatus: BoardingStatus.BOARDED,
        luggageCount: 2,
      } as any);

      const result = await TicketService.boardPassenger(
        'user-op-1',
        'tck-1',
        2,
      );

      expect(result.boardingStatus).toBe(BoardingStatus.BOARDED);
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tck-1' },
          data: expect.objectContaining({
            boardingStatus: BoardingStatus.BOARDED,
            luggageCount: 2,
          }),
        }),
      );
    });

    it('throws 400 when trip has already departed', async () => {
      const departedTicket = {
        id: 'tck-1',
        booking: {
          status: BookingStatus.CONFIRMED,
          schedule: {
            status: TripStatus.DEPARTED,
            route: { operatorId: 'op-1' },
          },
        },
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ticket.findUnique).mockResolvedValue(
        departedTicket as any,
      );

      await expect(
        TicketService.boardPassenger('user-op-1', 'tck-1'),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.BAD_REQUEST,
        message: expect.stringContaining('Manifest is locked'),
      });
    });
  });

  it.each([BookingStatus.PENDING, BookingStatus.EXPIRED, BookingStatus.CANCELLED])(
    'refuses to board a passenger whose booking is %s (spec 0001, AC-6)',
    async status => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue({ id: 'op-1' } as any);
      vi.mocked(prisma.ticket.findUnique).mockResolvedValue({
        id: 'tck-1',
        booking: {
          status,
          schedule: { status: TripStatus.BOARDING, route: { operatorId: 'op-1' } },
        },
      } as any);

      await expect(
        TicketService.boardPassenger('user-op-1', 'tck-1'),
      ).rejects.toMatchObject({ statusCode: StatusCodes.BAD_REQUEST });
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    },
  );

  describe('unboardPassenger', () => {
    it('reverts passenger status to CHECKED_IN and clears boardedAt', async () => {
      const mockTicket = {
        id: 'tck-1',
        booking: {
          status: BookingStatus.CONFIRMED,
          schedule: {
            status: TripStatus.BOARDING,
            route: { operatorId: 'op-1' },
          },
        },
      };

      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(
        mockOperator as any,
      );
      vi.mocked(prisma.ticket.findUnique).mockResolvedValue(mockTicket as any);
      vi.mocked(prisma.ticket.update).mockResolvedValue({
        id: 'tck-1',
        boardingStatus: BoardingStatus.CHECKED_IN,
        boardedAt: null,
      } as any);

      const result = await TicketService.unboardPassenger('user-op-1', 'tck-1');

      expect(result.boardingStatus).toBe(BoardingStatus.CHECKED_IN);
      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'tck-1' },
        data: {
          boardingStatus: BoardingStatus.CHECKED_IN,
          boardedAt: null,
        },
      });
    });
  });

  describe('getDigitalPass', () => {
    it('returns digital pass with verified QR code payload', async () => {
      const mockTicketWithFullGraph = {
        id: 'tck-1',
        ticketNumber: 'TCK-88210-A',
        passengerName: 'Michael Chang',
        nationality: 'USA',
        passportOrId: 'P-8829104',
        cabinClass: CabinClass.STANDARD,
        luggageCount: 1,
        boardingStatus: BoardingStatus.CHECKED_IN,
        boardedAt: null,
        booking: {
          reference: 'FRY-20261020-001A',
          schedule: {
            id: 'trip-101',
            departureTime: new Date('2026-10-20T08:30:00.000Z'),
            arrivalTime: new Date('2026-10-20T09:15:00.000Z'),
            gate: 'Pier 4 - Gate A',
            route: {
              departurePort: { name: 'Honolulu Harbor' },
              destinationPort: { name: 'Kahului Harbor' },
              operator: { companyName: 'Island Ferry Co.' },
            },
            ferry: { name: 'Ocean Voyager I' },
          },
        },
      };

      vi.mocked(prisma.ticket.findFirst).mockResolvedValue(
        mockTicketWithFullGraph as any,
      );

      const result = await TicketService.getDigitalPass('TCK-88210-A');

      expect(result).toMatchObject({
        ticketNumber: 'TCK-88210-A',
        bookingReference: 'FRY-20261020-001A',
        passengerName: 'Michael Chang',
        qrCodePayload: 'PASS:TCK-88210-A:FRY-20261020-001A',
      });
      expect(result.trip.operatorName).toBe('Island Ferry Co.');
    });

    it('throws 404 when digital pass cannot be found', async () => {
      vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);

      await expect(
        TicketService.getDigitalPass('INVALID-PASS'),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
      });
    });
  });
});
