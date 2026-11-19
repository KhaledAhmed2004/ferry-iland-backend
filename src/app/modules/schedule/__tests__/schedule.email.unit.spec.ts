import { BookingStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sailing cancellation emails. An operator cancelling a sailing has to reach every
 * passenger still holding a ticket for it -- including the ones who booked it as
 * their return leg, which is the easy half to forget. The database and the mail
 * transport are the boundaries here, so both are fakes that record their calls.
 */

const { sendEmailOrThrow, scheduleFindUnique, bookingFindMany } = vi.hoisted(() => ({
  sendEmailOrThrow: vi.fn(),
  scheduleFindUnique: vi.fn(),
  bookingFindMany: vi.fn(),
}));

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    schedule: { findUnique: scheduleFindUnique },
    booking: { findMany: bookingFindMany },
  },
  default: {
    schedule: { findUnique: scheduleFindUnique },
    booking: { findMany: bookingFindMany },
  },
}));

vi.mock('../../../../helpers/email', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../helpers/email')>();
  return { ...actual, EmailService: { sendEmailOrThrow } };
});

import { ScheduleEmails } from '../schedule.email';

const SCHEDULE_ID = 'schedule-1';

const schedule = {
  departureTime: new Date('2026-12-01T09:30:00.000Z'),
  route: {
    departurePort: { name: 'Male Harbour' },
    destinationPort: { name: 'Hulhumale Pier' },
  },
  ferry: { name: 'Blue Lagoon' },
};

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  reference: 'BK-10001',
  leadPassengerName: 'Aisha Rahman',
  leadPassengerEmail: 'aisha@example.test',
  scheduleId: SCHEDULE_ID,
  returnScheduleId: null,
  ...over,
});

const sentTo = (email: string) =>
  sendEmailOrThrow.mock.calls.map(([mail]) => mail).find(mail => mail.to === email);

beforeEach(() => {
  vi.clearAllMocks();
  scheduleFindUnique.mockResolvedValue(schedule);
  sendEmailOrThrow.mockResolvedValue(undefined);
});

describe('ScheduleEmails.sendTripCancelled', () => {
  it('emails every passenger holding a live booking on the sailing', async () => {
    bookingFindMany.mockResolvedValue([
      booking(),
      booking({ id: 'booking-2', reference: 'BK-10002', leadPassengerEmail: 'omar@example.test' }),
    ]);

    await ScheduleEmails.sendTripCancelled(SCHEDULE_ID);

    expect(sendEmailOrThrow).toHaveBeenCalledTimes(2);
    expect(sentTo('aisha@example.test')).toBeDefined();
    expect(sentTo('omar@example.test')).toBeDefined();
  });

  it('looks up both legs and skips bookings that are already over', async () => {
    bookingFindMany.mockResolvedValue([]);

    await ScheduleEmails.sendTripCancelled(SCHEDULE_ID);

    const where = bookingFindMany.mock.calls[0][0].where;
    // A sailing booked as someone's return leg is booked too.
    expect(where.OR).toEqual([
      { scheduleId: SCHEDULE_ID },
      { returnScheduleId: SCHEDULE_ID },
    ]);
    // Cancelled and expired bookings are past caring.
    expect(where.status.in).toEqual([
      BookingStatus.PENDING,
      BookingStatus.CONFIRMED,
      BookingStatus.CHECKED_IN,
    ]);
    expect(where.status.in).not.toContain(BookingStatus.CANCELLED);
    expect(where.status.in).not.toContain(BookingStatus.EXPIRED);
  });

  it('names the trip, the reference and tells the passenger not to travel', async () => {
    bookingFindMany.mockResolvedValue([booking()]);

    await ScheduleEmails.sendTripCancelled(SCHEDULE_ID);

    const mail = sentTo('aisha@example.test');
    expect(mail.subject).toContain('Your sailing has been cancelled');
    expect(mail.html).toContain('BK-10001');
    expect(mail.html).toContain('Male Harbour');
    expect(mail.html).toContain('Hulhumale Pier');
    expect(mail.html).toContain('Blue Lagoon');
    expect(mail.html).toContain('do not travel to the pier');
  });

  it('says which leg was cancelled, and that the other one still stands', async () => {
    bookingFindMany.mockResolvedValue([
      booking({ scheduleId: 'outbound-9', returnScheduleId: SCHEDULE_ID }),
    ]);

    await ScheduleEmails.sendTripCancelled(SCHEDULE_ID);

    const mail = sentTo('aisha@example.test');
    expect(mail.html).toContain('return leg of your booking');
    expect(mail.html).toContain('The outbound leg is unchanged');
  });

  it('promises no refund it does not start', async () => {
    bookingFindMany.mockResolvedValue([booking()]);

    await ScheduleEmails.sendTripCancelled(SCHEDULE_ID);

    const mail = sentTo('aisha@example.test');
    // Cancelling a sailing does not issue a refund today; the mail must not claim it does.
    expect(mail.html).not.toMatch(/refund is on its way|has been refunded|we have refunded/i);
    expect(mail.html).toContain('arrange your refund');
  });

  it('keeps going when one passenger address fails', async () => {
    bookingFindMany.mockResolvedValue([
      booking(),
      booking({ id: 'booking-2', reference: 'BK-10002', leadPassengerEmail: 'omar@example.test' }),
    ]);
    sendEmailOrThrow.mockRejectedValueOnce(new Error('mailbox full'));

    await ScheduleEmails.sendTripCancelled(SCHEDULE_ID);

    expect(sendEmailOrThrow).toHaveBeenCalledTimes(2);
    expect(sentTo('omar@example.test')).toBeDefined();
  });

  it('sends nothing when the sailing had no bookings', async () => {
    bookingFindMany.mockResolvedValue([]);

    await ScheduleEmails.sendTripCancelled(SCHEDULE_ID);

    expect(sendEmailOrThrow).not.toHaveBeenCalled();
  });

  it('sends nothing when the sailing no longer exists', async () => {
    scheduleFindUnique.mockResolvedValue(null);

    await ScheduleEmails.sendTripCancelled(SCHEDULE_ID);

    expect(bookingFindMany).not.toHaveBeenCalled();
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
  });

  it('never throws, so a mail problem cannot undo the cancellation', async () => {
    scheduleFindUnique.mockRejectedValue(new Error('database gone'));

    await expect(ScheduleEmails.sendTripCancelled(SCHEDULE_ID)).resolves.toBeUndefined();
  });
});

describe('ScheduleEmails.sendTripsCancelled', () => {
  it('notifies the passengers of every sailing a bulk change cancelled', async () => {
    bookingFindMany.mockResolvedValue([booking()]);

    await ScheduleEmails.sendTripsCancelled(['schedule-1', 'schedule-2', 'schedule-3']);

    expect(scheduleFindUnique).toHaveBeenCalledTimes(3);
    expect(sendEmailOrThrow).toHaveBeenCalledTimes(3);
  });

  it('carries on with the other sailings when one of them fails', async () => {
    bookingFindMany.mockResolvedValue([booking()]);
    scheduleFindUnique.mockRejectedValueOnce(new Error('database gone'));

    await expect(
      ScheduleEmails.sendTripsCancelled(['schedule-1', 'schedule-2']),
    ).resolves.toBeUndefined();
    expect(sendEmailOrThrow).toHaveBeenCalledTimes(1);
  });
});
