import { BookingStatus } from '@prisma/client';
import config from '../../../config';
import { prisma } from '../../../shared/prisma';
import { logger } from '../../../shared/logger';
import { EmailService, emailTemplates } from '../../../helpers/email';

/**
 * Sailing cancellation emails. An operator cancelling a sailing used to change
 * one row and tell nobody, so passengers holding a paid ticket found out at the
 * pier. Every function here runs after the status change has committed, loads
 * what it needs itself, and never throws: a mail problem is logged and the
 * cancellation stays applied.
 *
 * These emails do not promise a refund. Cancelling a sailing does not start one
 * today; the passenger is asked to reply so the refund can be worked by hand.
 */

/** A booking still owed a notice; cancelled and expired ones are past caring. */
const LIVE_BOOKING_STATUSES = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
];

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** `Mon, Nov 9, 07:30 PM` for a trip departure. */
const tripDateTime = (instant: Date) =>
  instant.toLocaleString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

const manageUrl = (reference: string) =>
  config.frontend_url
    ? `${config.frontend_url.replace(/\/$/, '')}/manage-booking/${encodeURIComponent(reference)}`
    : undefined;

const send = async (label: string, run: () => Promise<void>) => {
  try {
    await run();
  } catch (error) {
    logger.error(`Schedule email "${label}" failed: ${(error as Error)?.message}`);
  }
};

const scheduleInclude = {
  route: {
    include: {
      departurePort: { select: { name: true } },
      destinationPort: { select: { name: true } },
    },
  },
  ferry: { select: { name: true } },
} as const;

type CancelledSchedule = {
  departureTime: Date;
  route: {
    departurePort: { name: string };
    destinationPort: { name: string };
  };
  ferry: { name: string };
};

const tripText = (schedule: CancelledSchedule) =>
  `${escapeHtml(schedule.route.departurePort.name)} to ${escapeHtml(
    schedule.route.destinationPort.name,
  )} on ${escapeHtml(schedule.ferry.name)}, ${tripDateTime(schedule.departureTime)}`;

const notifyOne = async (
  booking: {
    reference: string;
    leadPassengerName: string;
    leadPassengerEmail: string;
    scheduleId: string;
    returnScheduleId: string | null;
  },
  scheduleId: string,
  schedule: CancelledSchedule,
) => {
  const isReturnLeg = booking.returnScheduleId === scheduleId;
  const legPhrase = booking.returnScheduleId
    ? isReturnLeg
      ? 'The return leg of your booking'
      : 'The outbound leg of your booking'
    : 'Your sailing';
  const remainder = booking.returnScheduleId
    ? ` The ${isReturnLeg ? 'outbound' : 'return'} leg is unchanged.`
    : '';

  await EmailService.sendEmailOrThrow(
    emailTemplates.notificationTemplate({
      email: booking.leadPassengerEmail,
      name: escapeHtml(booking.leadPassengerName),
      title: 'Your sailing has been cancelled',
      message:
        `${legPhrase} <strong>${escapeHtml(booking.reference)}</strong> has been cancelled by the operator: ` +
        `${tripText(schedule)}.${remainder}` +
        '<br/><br/>Please do not travel to the pier for this sailing. ' +
        'Reply to this email and our team will arrange your refund or move you to another sailing.',
      ...(manageUrl(booking.reference)
        ? {
            actionText: 'View your booking',
            actionUrl: manageUrl(booking.reference) as string,
          }
        : {}),
    }),
  );
};

/**
 * Email every passenger still holding a live booking on this sailing, whether it
 * is their outbound or their return leg. One bad address does not stop the rest.
 */
const sendTripCancelled = (scheduleId: string) =>
  send(`trip cancelled ${scheduleId}`, async () => {
    const schedule = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: scheduleInclude,
    });
    if (!schedule) return;

    const bookings = await prisma.booking.findMany({
      where: {
        status: { in: LIVE_BOOKING_STATUSES },
        OR: [{ scheduleId }, { returnScheduleId: scheduleId }],
      },
      select: {
        id: true,
        reference: true,
        leadPassengerName: true,
        leadPassengerEmail: true,
        scheduleId: true,
        returnScheduleId: true,
      },
    });
    if (bookings.length === 0) return;

    let failed = 0;
    for (const booking of bookings) {
      try {
        await notifyOne(booking, scheduleId, schedule);
      } catch (error) {
        failed += 1;
        logger.error(
          `Cancellation email for booking ${booking.reference} failed: ${(error as Error)?.message}`,
        );
      }
    }

    logger.info(
      `Sailing ${scheduleId} cancelled: notified ${bookings.length - failed}/${bookings.length} booking(s)`,
    );
  });

/** Same notice, for a bulk status change that cancelled several sailings. */
const sendTripsCancelled = async (scheduleIds: string[]) => {
  for (const scheduleId of scheduleIds) {
    await sendTripCancelled(scheduleId);
  }
};

export const ScheduleEmails = {
  sendTripCancelled,
  sendTripsCancelled,
};
