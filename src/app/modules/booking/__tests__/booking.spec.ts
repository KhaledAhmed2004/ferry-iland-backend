import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import {
  BoardingStatus,
  BookingStatus,
  CabinClass,
  PaymentProvider,
  PaymentStatus,
  TripStatus,
} from '@prisma/client';
import { BookingService } from '../booking.service';
import { calculateBookingAmounts, serializePayment } from '../booking.payment';
import { prisma } from '../../../../shared/prisma';
import config from '../../../../config';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    $transaction: vi.fn(callback => callback(prisma)),
    operatorProfile: {
      findUnique: vi.fn(),
    },
    schedule: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    booking: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    ticket: {
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
    payment: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../../../config', () => ({
  default: { payments: { enabled: false } },
}));

vi.mock('../../admin/admin.service', () => ({
  AdminService: {
    getOrCreatePlatformSettings: vi.fn(async () => ({
      commissionRate: 10,
      seatHoldMinutes: 15,
    })),
  },
}));

const fullPayment = {
  id: 'pay-1',
  bookingId: 'book-1',
  amountCents: 6500,
  currency: 'usd',
  commissionRate: 10,
  platformCommissionCents: 650,
  operatorPayoutCents: 5850,
  provider: PaymentProvider.MANUAL,
  stripePaymentIntentId: 'pi_secret_ref',
  status: PaymentStatus.PENDING,
  lastFailureCode: 'card_declined',
  lastFailureMessage: 'Your card was declined',
  paymentMethod: null,
  paidAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  refunds: [],
};

const threePassengers = [
  { passengerName: 'Elena Rodriguez', nationality: 'USA', passportOrId: 'P-12345', cabinClass: CabinClass.STANDARD },
  { passengerName: 'Carlos Rodriguez', nationality: 'USA', passportOrId: 'P-12346', cabinClass: CabinClass.STANDARD },
  { passengerName: 'Leo Rodriguez', nationality: 'USA', passportOrId: 'P-12347', cabinClass: CabinClass.STANDARD },
];

const bookingPayload = {
  scheduleId: 'sch-1',
  leadPassengerName: 'Elena Rodriguez',
  leadPassengerEmail: 'elena@example.com',
  adultsCount: 2,
  childrenCount: 1,
  passengers: threePassengers,
};

describe('BookingService Unit Tests', () => {
  const mockSchedule = {
    id: 'sch-1',
    adultFare: 25,
    childFare: 15,
    availableSeats: 10,
    status: TripStatus.ON_TIME,
    // Comfortably in the future so the "already departed" guard never trips by accident.
    departureTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    route: {
      operatorId: 'op-1',
      departurePort: { name: 'Malé' },
      destinationPort: { name: 'Maafushi' },
    },
    ferry: { name: 'Ocean Speed 1' },
  };

  const primeCreateMocks = (schedule = mockSchedule) => {
    vi.mocked(prisma.schedule.findUnique).mockResolvedValue(schedule as any);
    vi.mocked(prisma.schedule.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.booking.create).mockImplementation(
      (async ({ data }: any) => ({ id: 'book-1', ...data })) as any,
    );
    vi.mocked(prisma.ticket.createMany).mockResolvedValue({ count: 3 } as any);
    vi.mocked(prisma.payment.create).mockResolvedValue({} as any);
    vi.mocked(prisma.booking.findUniqueOrThrow).mockImplementation((async () => {
      const bookingData = vi.mocked(prisma.booking.create).mock.calls[0][0].data;
      const paymentData = vi.mocked(prisma.payment.create).mock.calls[0][0].data;
      return {
        id: 'book-1',
        ...bookingData,
        tickets: [{ id: 'tck-1' }, { id: 'tck-2' }, { id: 'tck-3' }],
        payment: { ...fullPayment, ...paymentData, refunds: [] },
      };
    }) as any);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (config as any).payments.enabled = false;
  });

  describe('calculateBookingAmounts', () => {
    it('stores cents and a commission split that always sums exactly', () => {
      const amounts = calculateBookingAmounts({
        adultsCount: 3,
        childrenCount: 0,
        adultFare: 33.33,
        childFare: 0,
        commissionRate: 12.5,
      });
      expect(amounts.amountCents).toBe(9999);
      expect(amounts.totalAmount).toBe(99.99);
      expect(amounts.platformCommissionCents + amounts.operatorPayoutCents).toBe(9999);
    });
  });

  describe('createBooking', () => {
    it('flag off: confirms the booking with an unpaid MANUAL payment and never a fake transaction', async () => {
      primeCreateMocks();

      const result = await BookingService.createBooking('user-1', bookingPayload);

      expect(result.status).toBe(BookingStatus.CONFIRMED);
      expect(prisma.schedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sch-1', availableSeats: { gte: 3 } },
        data: { availableSeats: { decrement: 3 } },
      });
      const bookingData = vi.mocked(prisma.booking.create).mock.calls[0][0].data;
      expect(bookingData).toMatchObject({
        status: BookingStatus.CONFIRMED,
        totalAmount: 65,
        holdExpiresAt: null,
      });
      expect(bookingData.confirmedAt).toBeInstanceOf(Date);

      const paymentData = vi.mocked(prisma.payment.create).mock.calls[0][0].data;
      expect(paymentData).toMatchObject({
        amountCents: 6500,
        currency: 'usd',
        commissionRate: 10,
        platformCommissionCents: 650,
        operatorPayoutCents: 5850,
        provider: PaymentProvider.MANUAL,
        status: PaymentStatus.PENDING,
        paidAt: null,
      });
      expect(paymentData).not.toHaveProperty('transactionId');
      expect(prisma.ticket.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            passengerName: 'Elena Rodriguez',
            boardingStatus: BoardingStatus.PENDING,
          }),
        ]),
      });
    });

    it('flag on: starts PENDING with a seat hold and a STRIPE payment', async () => {
      (config as any).payments.enabled = true;
      primeCreateMocks();
      const before = Date.now();

      const result = await BookingService.createBooking(null, bookingPayload);

      expect(result.status).toBe(BookingStatus.PENDING);
      const bookingData = vi.mocked(prisma.booking.create).mock.calls[0][0].data;
      const holdMs = (bookingData.holdExpiresAt as Date).getTime() - before;
      expect(holdMs).toBeGreaterThanOrEqual(15 * 60 * 1000 - 50);
      expect(holdMs).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
      expect(bookingData.confirmedAt).toBeNull();
      expect(vi.mocked(prisma.payment.create).mock.calls[0][0].data).toMatchObject({
        provider: PaymentProvider.STRIPE,
        status: PaymentStatus.PENDING,
      });
    });

    it('zero fare: confirms right away with a COMPLETED manual payment even when the flag is on', async () => {
      (config as any).payments.enabled = true;
      primeCreateMocks({ ...mockSchedule, adultFare: 0, childFare: 0 });

      const result = await BookingService.createBooking(null, bookingPayload);

      expect(result.status).toBe(BookingStatus.CONFIRMED);
      const paymentData = vi.mocked(prisma.payment.create).mock.calls[0][0].data;
      expect(paymentData).toMatchObject({
        amountCents: 0,
        provider: PaymentProvider.MANUAL,
        status: PaymentStatus.COMPLETED,
      });
      expect(paymentData.paidAt).toBeInstanceOf(Date);
    });

    it('returns only the customer view of the payment', async () => {
      primeCreateMocks();

      const result = await BookingService.createBooking(null, bookingPayload);

      expect(result.payment).toEqual({
        status: PaymentStatus.PENDING,
        amountCents: 6500,
        currency: 'usd',
        paidAt: null,
        refunds: [],
      });
    });

    it('throws 400 when available seats are insufficient', async () => {
      vi.mocked(prisma.schedule.findUnique).mockResolvedValue({
        ...mockSchedule,
        availableSeats: 1,
      } as any);

      await expect(
        BookingService.createBooking('user-1', {
          scheduleId: 'sch-1',
          leadPassengerName: 'John',
          leadPassengerEmail: 'john@example.com',
          adultsCount: 2,
          passengers: [
            { passengerName: 'P1', nationality: 'US', passportOrId: 'ID1' },
            { passengerName: 'P2', nationality: 'US', passportOrId: 'ID2' },
          ],
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.BAD_REQUEST,
        message: 'Not enough available seats on this trip',
      });
      expect(prisma.schedule.updateMany).not.toHaveBeenCalled();
    });

    it('throws 400 when a concurrent booking took the seats after the read (conditional update matched no row)', async () => {
      primeCreateMocks();
      vi.mocked(prisma.schedule.updateMany).mockResolvedValue({ count: 0 } as any);

      await expect(
        BookingService.createBooking('user-1', bookingPayload),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.BAD_REQUEST,
        message: 'Not enough available seats on this trip',
      });
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('throws 400 if trip is already departed', async () => {
      vi.mocked(prisma.schedule.findUnique).mockResolvedValue({
        ...mockSchedule,
        status: TripStatus.DEPARTED,
      } as any);

      await expect(
        BookingService.createBooking('user-1', {
          scheduleId: 'sch-1',
          leadPassengerName: 'John',
          leadPassengerEmail: 'john@example.com',
          adultsCount: 1,
          passengers: [
            { passengerName: 'P1', nationality: 'US', passportOrId: 'ID1' },
          ],
        }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.BAD_REQUEST,
        message: 'Cannot book tickets on a departed or cancelled trip',
      });
    });

    it('throws 400 when the departure time has passed even though the status is still ON_TIME', async () => {
      primeCreateMocks({
        ...mockSchedule,
        status: TripStatus.ON_TIME,
        departureTime: new Date(Date.now() - 60 * 1000),
      });

      await expect(BookingService.createBooking('user-1', bookingPayload)).rejects.toMatchObject({
        statusCode: StatusCodes.BAD_REQUEST,
        message: 'This trip has already departed',
      });
      expect(prisma.schedule.updateMany).not.toHaveBeenCalled();
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });
  });

  describe('getBookingByReference', () => {
    const guestBooking = {
      id: 'book-1',
      userId: null,
      reference: 'FRY-20261020-001A',
      leadPassengerEmail: 'test@example.com',
      payment: fullPayment,
    };

    it('returns a guest booking when the lead passenger email matches (case and spaces ignored)', async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue(guestBooking as any);

      const result = await BookingService.getBookingByReference('FRY-20261020-001A', {
        userId: null,
        email: '  TEST@example.com ',
      });

      expect(result.reference).toBe('FRY-20261020-001A');
      expect(result.payment).not.toHaveProperty('platformCommissionCents');
    });

    it('returns 404 for a guest booking when the email is missing or wrong', async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue(guestBooking as any);

      await expect(
        BookingService.getBookingByReference('FRY-20261020-001A', { userId: null }),
      ).rejects.toMatchObject({ statusCode: StatusCodes.NOT_FOUND });
      await expect(
        BookingService.getBookingByReference('FRY-20261020-001A', {
          userId: null,
          email: 'wrong@example.com',
        }),
      ).rejects.toMatchObject({ statusCode: StatusCodes.NOT_FOUND });
    });

    it('lets the owner read without an email', async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue({
        ...guestBooking,
        userId: 'user-1',
      } as any);

      const result = await BookingService.getBookingByReference('FRY-20261020-001A', {
        userId: 'user-1',
        role: 'USER',
      });
      expect(result.id).toBe('book-1');
    });

    it('gives an admin the full payment view', async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue(guestBooking as any);

      const result = await BookingService.getBookingByReference('FRY-20261020-001A', {
        userId: 'admin-1',
        role: 'ADMIN',
      });
      expect(result.payment).toMatchObject({
        commissionRate: 10,
        platformCommissionCents: 650,
        stripePaymentIntentId: 'pi_secret_ref',
        lastFailureCode: 'card_declined',
      });
    });

    it('throws 404 when booking reference is not found', async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue(null);

      await expect(
        BookingService.getBookingByReference('INVALID-REF', { userId: null, email: 'x@y.z' }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.NOT_FOUND,
      });
    });
  });

  describe('serializePayment', () => {
    it('shows operators their payout but never the commission or failure internals', () => {
      const view = serializePayment(fullPayment as any, 'OPERATOR') as Record<string, unknown>;
      expect(view.operatorPayoutCents).toBe(5850);
      expect(view).not.toHaveProperty('platformCommissionCents');
      expect(view).not.toHaveProperty('commissionRate');
      expect(view).not.toHaveProperty('lastFailureMessage');
      expect(view).not.toHaveProperty('stripePaymentIntentId');
    });

    it('never returns the deprecated Float columns or transactionId', () => {
      const legacy = { ...fullPayment, amount: 65, platformCommission: 6.5, transactionId: 'TXN-1' };
      const view = serializePayment(legacy as any, 'ADMIN') as Record<string, unknown>;
      expect(view).not.toHaveProperty('amount');
      expect(view).not.toHaveProperty('platformCommission');
      expect(view).not.toHaveProperty('transactionId');
    });
  });

  describe('cancelBooking', () => {
    const ownedBooking = {
      id: 'book-1',
      userId: 'user-1',
      scheduleId: 'sch-1',
      leadPassengerEmail: 'owner@example.com',
      adultsCount: 2,
      childrenCount: 1,
      status: BookingStatus.CONFIRMED,
      payment: { id: 'pay-1', status: PaymentStatus.PENDING },
    };

    const primeCancel = (booking: any, updatedCount = 1) => {
      vi.mocked(prisma.booking.findFirst).mockResolvedValue(booking);
      vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: updatedCount } as any);
      vi.mocked(prisma.schedule.update).mockResolvedValue({} as any);
      vi.mocked(prisma.payment.update).mockResolvedValue({} as any);
      vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
        ...booking,
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        tickets: [],
        payment: { ...fullPayment, status: PaymentStatus.CANCELED },
      } as any);
    };

    it('cancels booking, restores seats once, and cancels the unpaid payment', async () => {
      primeCancel(ownedBooking);

      const result = await BookingService.cancelBooking('book-1', {
        userId: 'user-1',
        role: 'USER',
      });

      expect(result.status).toBe(BookingStatus.CANCELLED);
      expect(prisma.booking.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'book-1',
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        },
        data: { status: BookingStatus.CANCELLED, cancelledAt: expect.any(Date) },
      });
      expect(prisma.schedule.update).toHaveBeenCalledWith({
        where: { id: 'sch-1' },
        data: { availableSeats: { increment: 3 } },
      });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: PaymentStatus.CANCELED },
      });
    });

    it('keeps a COMPLETED payment as COMPLETED (refunds are a later feature)', async () => {
      primeCancel({ ...ownedBooking, payment: { id: 'pay-1', status: PaymentStatus.COMPLETED } });

      await BookingService.cancelBooking('book-1', { userId: 'user-1', role: 'USER' });

      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('returns seats only once when a concurrent cancel already won', async () => {
      primeCancel(ownedBooking, 0);

      await expect(
        BookingService.cancelBooking('book-1', { userId: 'user-1', role: 'USER' }),
      ).rejects.toMatchObject({ statusCode: StatusCodes.BAD_REQUEST });
      expect(prisma.schedule.update).not.toHaveBeenCalled();
    });

    it.each([BookingStatus.CHECKED_IN, BookingStatus.EXPIRED])(
      'rejects cancelling a %s booking with 400',
      async status => {
        primeCancel({ ...ownedBooking, status });

        await expect(
          BookingService.cancelBooking('book-1', { userId: 'user-1', role: 'USER' }),
        ).rejects.toMatchObject({ statusCode: StatusCodes.BAD_REQUEST });
        expect(prisma.booking.updateMany).not.toHaveBeenCalled();
      },
    );

    it('throws 403 when a signed in user does not own the booking and is not admin', async () => {
      primeCancel({ ...ownedBooking, userId: 'owner-user' });

      await expect(
        BookingService.cancelBooking('book-1', { userId: 'attacker-user', role: 'USER' }),
      ).rejects.toMatchObject({
        statusCode: StatusCodes.FORBIDDEN,
      });
    });

    it('lets a guest cancel only with the matching lead passenger email', async () => {
      const guest = { ...ownedBooking, userId: null };
      primeCancel(guest);

      await expect(
        BookingService.cancelBooking('book-1', { userId: null, email: 'nope@example.com' }),
      ).rejects.toMatchObject({ statusCode: StatusCodes.NOT_FOUND });
      await expect(
        BookingService.cancelBooking('book-1', { userId: null }),
      ).rejects.toMatchObject({ statusCode: StatusCodes.NOT_FOUND });

      const result = await BookingService.cancelBooking('book-1', {
        userId: null,
        email: 'OWNER@example.com',
      });
      expect(result.status).toBe(BookingStatus.CANCELLED);
    });
  });

  describe('checkInBooking', () => {
    const mockOperator = { id: 'op-1', userId: 'user-op-1' };

    it('marks a confirmed booking and its tickets as CHECKED_IN', async () => {
      vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(mockOperator as any);
      vi.mocked(prisma.booking.findUnique).mockResolvedValue({
        id: 'book-1',
        status: BookingStatus.CONFIRMED,
        schedule: { route: { operatorId: 'op-1' } },
      } as any);
      vi.mocked(prisma.ticket.updateMany).mockResolvedValue({ count: 2 } as any);
      vi.mocked(prisma.booking.update).mockResolvedValue({
        id: 'book-1',
        status: BookingStatus.CHECKED_IN,
      } as any);

      const result = await BookingService.checkInBooking('user-op-1', 'book-1');

      expect(result.status).toBe(BookingStatus.CHECKED_IN);
      expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
        where: { bookingId: 'book-1' },
        data: { boardingStatus: BoardingStatus.CHECKED_IN },
      });
    });

    it.each([BookingStatus.PENDING, BookingStatus.EXPIRED, BookingStatus.CANCELLED])(
      'refuses to check in a %s booking',
      async status => {
        vi.mocked(prisma.operatorProfile.findUnique).mockResolvedValue(mockOperator as any);
        vi.mocked(prisma.booking.findUnique).mockResolvedValue({
          id: 'book-1',
          status,
          schedule: { route: { operatorId: 'op-1' } },
        } as any);

        await expect(
          BookingService.checkInBooking('user-op-1', 'book-1'),
        ).rejects.toMatchObject({ statusCode: StatusCodes.BAD_REQUEST });
        expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
      },
    );
  });
});
