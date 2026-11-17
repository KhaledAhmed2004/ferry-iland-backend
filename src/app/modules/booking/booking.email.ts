import { BookingRequestStatus } from '@prisma/client';
import config from '../../../config';
import { prisma } from '../../../shared/prisma';
import { logger } from '../../../shared/logger';
import { EmailService, emailTemplates } from '../../../helpers/email';

/**
 * Spec 0004, AC-17: booking change emails. Every function here runs after the action has
 * committed, loads what it needs itself, and never throws: a mail problem is logged and the
 * cancel, request, or move stays applied.
 */

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

const money = (cents: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(
    cents / 100,
  );

const manageUrl = (reference: string) =>
  config.frontend_url
    ? `${config.frontend_url.replace(/\/$/, '')}/manage-booking/${encodeURIComponent(reference)}`
    : undefined;

const legInclude = {
  include: { route: { include: { departurePort: true, destinationPort: true } } },
} as const;

type Leg = {
  departureTime: Date;
  route: { departurePort: { name: string }; destinationPort: { name: string } };
};

const legText = (leg: Leg) =>
  `${escapeHtml(leg.route.departurePort.name)} to ${escapeHtml(leg.route.destinationPort.name)}, ${tripDateTime(leg.departureTime)}`;

const send = async (label: string, run: () => Promise<void>) => {
  try {
    await run();
  } catch (error) {
    logger.error(`Booking email "${label}" failed: ${(error as Error)?.message}`);
  }
};

const notify = (data: {
  email: string;
  name?: string;
  title: string;
  message: string;
  reference?: string;
}) =>
  EmailService.sendEmailOrThrow(
    emailTemplates.notificationTemplate({
      email: data.email,
      name: data.name ? escapeHtml(data.name) : undefined,
      title: data.title,
      message: data.message,
      ...(data.reference && manageUrl(data.reference)
        ? { actionText: 'View your booking', actionUrl: manageUrl(data.reference) }
        : {}),
    }),
  );

/** The customer cancelled on their own and a refund was started (AC-1, AC-17). */
const sendSelfCancelRefund = (bookingId: string, refundCents: number) =>
  send('self cancel refund', async () => {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { payment: true, schedule: legInclude },
    });
    await notify({
      email: booking.leadPassengerEmail,
      name: booking.leadPassengerName,
      reference: booking.reference,
      title: 'Your booking is cancelled',
      message:
        `Booking <strong>${booking.reference}</strong> (${legText(booking.schedule)}) is cancelled. ` +
        `A refund of <strong>${money(refundCents, booking.payment?.currency)}</strong> is on its way to your card. ` +
        'Banks usually take 5 to 10 business days to show it.',
    });
  });

const requestLabel = (type: string, leg: string | null) =>
  leg === 'RETURN' ? 'a different return trip' : type === 'CANCEL' ? 'cancellation' : 'a move to another trip';

/** A new request: the customer gets a receipt, the ferry owner operator gets a heads up (AC-17). */
const sendRequestReceived = (requestId: string) =>
  send('request received', async () => {
    const request = await prisma.bookingRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: {
        booking: {
          include: {
            schedule: {
              include: {
                ...legInclude.include,
                ferry: { include: { operator: { include: { user: { select: { email: true } } } } } },
              },
            },
          },
        },
      },
    });
    const { booking } = request;
    const what = requestLabel(request.type, request.leg);
    const reasonLine = request.reason
      ? `<br/><br/>Your message: <em>${escapeHtml(request.reason)}</em>`
      : '';

    // Its own send, so a failed customer email never stops the operator's heads up.
    await send('request received (customer)', () =>
      notify({
        email: booking.leadPassengerEmail,
        name: booking.leadPassengerName,
        reference: booking.reference,
        title: 'We received your request',
        message:
          `Your request for ${what} on booking <strong>${booking.reference}</strong> ` +
          `(${legText(booking.schedule)}) was sent to the ferry operator. ` +
          `You will get an email and see their answer on your booking page.${reasonLine}`,
      }),
    );

    const operatorEmail = booking.schedule.ferry.operator.user?.email;
    if (!operatorEmail) {
      logger.warn(`No operator email for booking ${booking.reference}, request ${request.id}`);
      return;
    }
    await EmailService.sendEmailOrThrow(
      emailTemplates.notificationTemplate({
        email: operatorEmail,
        title: 'New change request',
        message:
          `${escapeHtml(booking.leadPassengerName)} asked for ${what} on booking ` +
          `<strong>${booking.reference}</strong> (${legText(booking.schedule)}).${
            request.reason ? `<br/><br/>Message: <em>${escapeHtml(request.reason)}</em>` : ''
          }<br/><br/>Open the Requests tab on your Bookings page to answer it.`,
        ...(config.frontend_url
          ? {
              actionText: 'Open requests',
              actionUrl: `${config.frontend_url.replace(/\/$/, '')}/dashboard/operator/bookings`,
            }
          : {}),
      }),
    );
  });

const RESOLVED_TEXT: Partial<Record<BookingRequestStatus, string>> = {
  CANCELLED: 'was approved and your booking is cancelled',
  RESCHEDULED: 'was approved and your booking was moved',
  REJECTED: 'could not be approved, so your booking stays as it is',
};

/** Staff answered a request, any outcome, with their note (AC-17). */
const sendRequestResolved = (requestId: string, refundCents: number) =>
  send('request resolved', async () => {
    const request = await prisma.bookingRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: {
        booking: { include: { payment: true, schedule: legInclude, returnSchedule: legInclude } },
      },
    });
    const { booking } = request;
    const outcome = RESOLVED_TEXT[request.status] ?? 'was handled';
    const trips =
      request.status === BookingRequestStatus.RESCHEDULED
        ? `<br/><br/>Your trip now: ${legText(booking.schedule)}${
            booking.returnSchedule ? `<br/>Return: ${legText(booking.returnSchedule)}` : ''
          }<br/>Your ticket numbers stay the same.`
        : '';
    const refund =
      request.status === BookingRequestStatus.CANCELLED && refundCents > 0
        ? `<br/><br/>A refund of <strong>${money(refundCents, booking.payment?.currency)}</strong> is on its way to your card.`
        : '';
    const note = request.staffNote
      ? `<br/><br/>Note from the operator: <em>${escapeHtml(request.staffNote)}</em>`
      : '';

    await notify({
      email: booking.leadPassengerEmail,
      name: booking.leadPassengerName,
      reference: booking.reference,
      title: 'Update on your request',
      message: `Your request for ${requestLabel(request.type, request.leg)} on booking <strong>${booking.reference}</strong> ${outcome}.${trips}${refund}${note}`,
    });
  });

/** Staff moved the booking directly, for example after a missed sailing (AC-17). */
const sendBookingMoved = (bookingId: string, reason?: string | null) =>
  send('booking moved', async () => {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { schedule: legInclude, returnSchedule: legInclude },
    });
    await notify({
      email: booking.leadPassengerEmail,
      name: booking.leadPassengerName,
      reference: booking.reference,
      title: 'Your trip was changed',
      message:
        `The ferry operator moved booking <strong>${booking.reference}</strong>.<br/><br/>` +
        `Your trip now: ${legText(booking.schedule)}` +
        (booking.returnSchedule ? `<br/>Return: ${legText(booking.returnSchedule)}` : '') +
        '<br/><br/>Your ticket numbers and price stay the same.' +
        (reason ? `<br/><br/>Note: <em>${escapeHtml(reason)}</em>` : ''),
    });
  });

/** Plain text leg line for the receipt rows; the receipt template escapes it. */
const plainLegText = (leg: Leg) =>
  `${leg.route.departurePort.name} to ${leg.route.destinationPort.name}, ${tripDateTime(leg.departureTime)}`;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Feature 7: the receipt after a payment confirmed the booking. Called once, by whoever moved the
 * booking to CONFIRMED (sync, intent, webhook, or a late payment that took its seats again).
 */
const sendPaymentReceipt = (bookingId: string) =>
  send('payment receipt', async () => {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { payment: true, schedule: legInclude, returnSchedule: legInclude },
    });
    const { payment } = booking;
    if (!payment) {
      logger.warn(`No payment for booking ${booking.reference}, receipt not sent`);
      return;
    }
    const paidAt = (payment.paidAt ?? new Date()).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const passengers = [
      plural(booking.adultsCount, 'adult', 'adults'),
      ...(booking.childrenCount ? [plural(booking.childrenCount, 'child', 'children')] : []),
    ].join(', ');
    const url = manageUrl(booking.reference);

    await EmailService.sendEmailOrThrow(
      emailTemplates.invoiceTemplate({
        name: booking.leadPassengerName,
        email: booking.leadPassengerEmail,
        invoiceNumber: booking.reference,
        date: paidAt,
        amount: money(payment.amountCents, payment.currency),
        rows: [
          { label: booking.returnSchedule ? 'Outbound' : 'Trip', value: plainLegText(booking.schedule) },
          ...(booking.returnSchedule
            ? [{ label: 'Return', value: plainLegText(booking.returnSchedule) }]
            : []),
          { label: 'Passengers', value: passengers },
        ],
        paymentMethod: 'Card',
        ...(url ? { actionUrl: url, actionText: 'View your booking and tickets' } : {}),
      }),
    );
  });

/**
 * Feature 7: Stripe confirmed a refund. Called once per refund, by whoever moved it to SUCCEEDED
 * (the refund create response or the refund.updated webhook), for every refund reason.
 */
const sendRefundIssued = (refundId: string) =>
  send('refund issued', async () => {
    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { payment: { include: { booking: true } } },
    });
    const { booking } = refund.payment;
    const late =
      refund.reason === 'LATE_PAYMENT'
        ? '<br/><br/>Your payment arrived after the seat hold on this booking ended and the seats ' +
          'were no longer free, so the booking could not be confirmed.'
        : '';
    await notify({
      email: booking.leadPassengerEmail,
      name: booking.leadPassengerName,
      reference: booking.reference,
      title: 'Your refund was issued',
      message:
        `We sent <strong>${money(refund.amountCents, refund.payment.currency)}</strong> back to your card ` +
        `for booking <strong>${booking.reference}</strong>. ` +
        `Banks usually take 5 to 10 business days to show it.${late}`,
    });
  });

export const BookingEmails = {
  sendPaymentReceipt,
  sendRefundIssued,
  sendSelfCancelRefund,
  sendRequestReceived,
  sendRequestResolved,
  sendBookingMoved,
};
