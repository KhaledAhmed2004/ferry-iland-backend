import { describe, it, expect, vi } from 'vitest';
import {
  BookingRequestStatus,
  BookingStatus,
  PaymentProvider,
  PaymentStatus,
  RefundStatus,
} from '@prisma/client';
import {
  claimBooking,
  getCancellationInfo,
  isWithinFreeCancel,
  isWithinMoveWindow,
  refundableCents,
  refundStateOf,
} from '../booking.policy';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-11-10T12:00:00.000Z');
const at = (hours: number) => new Date(now.getTime() + hours * HOUR);

const payment = (over: Record<string, unknown> = {}) =>
  ({
    id: 'pay-1',
    amountCents: 10000,
    provider: PaymentProvider.STRIPE,
    status: PaymentStatus.COMPLETED,
    refunds: [],
    ...over,
  }) as any;

const refund = (amountCents: number, status: RefundStatus, minutesAgo = 0) =>
  ({ amountCents, status, createdAt: new Date(now.getTime() - minutesAgo * 60000) }) as any;

const request = (status: BookingRequestStatus, minutesAgo = 0) =>
  ({
    id: `req-${status}-${minutesAgo}`,
    type: 'CANCEL',
    leg: null,
    status,
    reason: null,
    staffNote: null,
    createdAt: new Date(now.getTime() - minutesAgo * 60000),
    updatedAt: new Date(now.getTime() - minutesAgo * 60000),
    resolvedAt: status === BookingRequestStatus.PENDING ? null : new Date(now.getTime() - minutesAgo * 60000),
  }) as any;

const booking = (over: Record<string, unknown> = {}) =>
  ({
    status: BookingStatus.CONFIRMED,
    schedule: { departureTime: at(48) },
    returnSchedule: null,
    payment: payment(),
    requests: [],
    ...over,
  }) as any;

describe('booking.policy (spec 0004)', () => {
  describe('time windows', () => {
    it('counts exactly 24h before departure as free cancel, one ms later not', () => {
      expect(isWithinFreeCancel(at(24), now)).toBe(true);
      expect(isWithinFreeCancel(new Date(at(24).getTime() - 1), now)).toBe(false);
    });

    it('allows a move until 24h after the leg departed', () => {
      expect(isWithinMoveWindow(at(-24), now)).toBe(true);
      expect(isWithinMoveWindow(at(-24.01), now)).toBe(false);
    });
  });

  describe('refundableCents', () => {
    it('is the collected amount minus refunds that did not fail', () => {
      const p = payment({
        refunds: [refund(3000, RefundStatus.SUCCEEDED), refund(2000, RefundStatus.FAILED)],
      });
      expect(refundableCents(p)).toBe(7000);
    });

    it.each([
      [{ provider: PaymentProvider.MANUAL }],
      [{ status: PaymentStatus.PENDING }],
      [{ status: PaymentStatus.REFUNDED }],
    ])('is 0 unless Stripe collected the money (%o)', over => {
      expect(refundableCents(payment(over))).toBe(0);
    });
  });

  describe('refundStateOf', () => {
    it('reports processing, refunded, and failed', () => {
      expect(refundStateOf(payment({ refunds: [refund(10000, RefundStatus.PENDING)] }))).toBe('PROCESSING');
      expect(
        refundStateOf(payment({ status: PaymentStatus.REFUNDED, refunds: [refund(10000, RefundStatus.SUCCEEDED)] })),
      ).toBe('REFUNDED');
      expect(refundStateOf(payment({ refunds: [refund(10000, RefundStatus.FAILED)] }))).toBe('FAILED');
      expect(refundStateOf(payment())).toBe('NONE');
    });
  });

  describe('getCancellationInfo truth table', () => {
    it.each([BookingStatus.CANCELLED, BookingStatus.EXPIRED])('%s → NONE', status => {
      expect(getCancellationInfo(booking({ status }), now).mode).toBe('NONE');
    });

    it('unpaid hold → SELF_CANCEL with 0 refund, even inside 24h', () => {
      const info = getCancellationInfo(
        booking({
          status: BookingStatus.PENDING,
          schedule: { departureTime: at(2) },
          payment: payment({ status: PaymentStatus.PENDING }),
        }),
        now,
      );
      expect(info).toMatchObject({ mode: 'SELF_CANCEL', refundCents: 0 });
    });

    it('a pending request → NONE and exposes it', () => {
      const info = getCancellationInfo(
        booking({ schedule: { departureTime: at(5) }, requests: [request(BookingRequestStatus.PENDING)] }),
        now,
      );
      expect(info.mode).toBe('NONE');
      expect(info.pendingRequest?.status).toBe('PENDING');
    });

    it('checked in with a future return → REQUEST for the return only', () => {
      const info = getCancellationInfo(
        booking({
          status: BookingStatus.CHECKED_IN,
          schedule: { departureTime: at(-3) },
          returnSchedule: { departureTime: at(30) },
        }),
        now,
      );
      expect(info).toMatchObject({ mode: 'REQUEST', requestScope: 'RETURN', refundCents: 0 });
    });

    it('checked in with no future return → NONE', () => {
      const info = getCancellationInfo(
        booking({ status: BookingStatus.CHECKED_IN, schedule: { departureTime: at(-3) } }),
        now,
      );
      expect(info).toMatchObject({ mode: 'NONE', refundCents: 0 });
    });

    it('confirmed Stripe 24h or more ahead → SELF_CANCEL with the full amount', () => {
      const info = getCancellationInfo(booking({ schedule: { departureTime: at(24) } }), now);
      expect(info).toMatchObject({ mode: 'SELF_CANCEL', refundCents: 10000, automaticRefund: true });
      expect(info.cutoffAt).toEqual(now);
    });

    it('confirmed manual payment 24h or more ahead → SELF_CANCEL, refund handled by staff', () => {
      const info = getCancellationInfo(
        booking({ payment: payment({ provider: PaymentProvider.MANUAL }) }),
        now,
      );
      expect(info).toMatchObject({ mode: 'SELF_CANCEL', refundCents: 0, automaticRefund: false });
    });

    it('confirmed inside 24h, before departure → REQUEST for the booking', () => {
      const info = getCancellationInfo(booking({ schedule: { departureTime: at(10) } }), now);
      expect(info).toMatchObject({ mode: 'REQUEST', requestScope: 'BOOKING' });
    });

    it('confirmed inside 24h with 3 requests used → NONE, latest resolved shown', () => {
      const info = getCancellationInfo(
        booking({
          schedule: { departureTime: at(10) },
          requests: [
            request(BookingRequestStatus.REJECTED, 30),
            request(BookingRequestStatus.WITHDRAWN, 20),
            request(BookingRequestStatus.REJECTED, 10),
          ],
        }),
        now,
      );
      expect(info.mode).toBe('NONE');
      expect(info.lastResolvedRequest?.id).toBe('req-REJECTED-10');
    });

    it('confirmed after outbound departure → NONE', () => {
      expect(getCancellationInfo(booking({ schedule: { departureTime: at(-1) } }), now).mode).toBe('NONE');
    });
  });

  describe('claimBooking', () => {
    const snapshot = {
      id: 'book-1',
      status: BookingStatus.CONFIRMED,
      scheduleId: 'sch-1',
      returnScheduleId: null,
    };

    it('updates only when status and both trips are unchanged', async () => {
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } as any;
      await claimBooking(tx, snapshot, { status: BookingStatus.CANCELLED });
      expect(tx.booking.updateMany).toHaveBeenCalledWith({
        where: snapshot,
        data: { status: BookingStatus.CANCELLED },
      });
    });

    it('throws 409 BOOKING_CHANGED when someone else changed it first', async () => {
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } } as any;
      await expect(claimBooking(tx, snapshot, {})).rejects.toMatchObject({
        statusCode: 409,
        data: { code: 'BOOKING_CHANGED' },
      });
    });
  });
});
