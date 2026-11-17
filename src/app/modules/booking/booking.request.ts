import {
  BookingLeg,
  BookingRequestStatus,
  BookingRequestType,
  BookingStatus,
} from '@prisma/client';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import {
  MAX_REQUESTS_PER_BOOKING,
  isUniqueViolation,
  isWithinFreeCancel,
  policyError,
  toRequestView,
} from './booking.policy';
import { IBookingRequester, assertBookingAccess, bookingIdentifierWhere } from './booking.access';
import { bookingForMoveInclude, checkMove } from './booking.move';
import { BookingEmails } from './booking.email';

/**
 * Spec 0004: the customer side of change requests. Inside 24 hours a customer cannot cancel on
 * their own, so they ask; the ferry's operator or an admin resolves it (bookingRequest module).
 */

export type ICreateBookingRequestPayload = {
  type: BookingRequestType;
  leg?: BookingLeg;
  reason?: string;
  preferredScheduleId?: string;
  preferredReturnScheduleId?: string;
};

const findBookingForRequest = (bookingIdentifier: string) =>
  prisma.booking.findFirst({
    where: bookingIdentifierWhere(bookingIdentifier),
    include: {
      ...bookingForMoveInclude,
      requests: { select: { id: true, status: true } },
    },
  });

/**
 * Which request this booking may take right now (AC-5), or null when none:
 * (a) a CONFIRMED booking whose outbound leaves in the future but inside 24 hours: CANCEL or
 *     RESCHEDULE of the whole booking;
 * (b) a CHECKED_IN booking whose return leaves in the future: RESCHEDULE of the return only.
 */
const allowedRequest = (
  booking: NonNullable<Awaited<ReturnType<typeof findBookingForRequest>>>,
  payload: ICreateBookingRequestPayload,
  now: Date,
): { leg: BookingLeg | null } | null => {
  const outboundDeparture = booking.schedule.departureTime;

  if (booking.status === BookingStatus.CONFIRMED) {
    const insideWindow =
      !isWithinFreeCancel(outboundDeparture, now) && outboundDeparture.getTime() > now.getTime();
    // leg is null for a whole booking request (spec data model).
    return insideWindow && !payload.leg ? { leg: null } : null;
  }

  if (booking.status === BookingStatus.CHECKED_IN) {
    const returnDeparture = booking.returnSchedule?.departureTime;
    const returnAhead = !!returnDeparture && returnDeparture.getTime() > now.getTime();
    const isReturnReschedule =
      payload.type === BookingRequestType.RESCHEDULE &&
      (!payload.leg || payload.leg === BookingLeg.RETURN);
    return returnAhead && isReturnReschedule ? { leg: BookingLeg.RETURN } : null;
  }

  return null;
};

const createRequest = async (
  bookingIdentifier: string,
  requester: IBookingRequester,
  payload: ICreateBookingRequestPayload,
  now: Date = new Date(),
) => {
  const booking = await findBookingForRequest(bookingIdentifier);
  assertBookingAccess(booking, requester, { allowAdmin: false, action: 'change' });

  const allowed = allowedRequest(booking, payload, now);
  if (!allowed) {
    throw policyError(
      'REQUEST_NOT_ALLOWED',
      booking.status === BookingStatus.CHECKED_IN
        ? 'After boarding you can only ask for a different return trip, before it departs.'
        : 'A request can only be sent in the 24 hours before departure. Earlier than that, you can cancel on your own.',
    );
  }

  if (booking.requests.some(r => r.status === BookingRequestStatus.PENDING)) {
    throw policyError('REQUEST_PENDING', 'This booking already has a request waiting for the operator.');
  }
  if (booking.requests.length >= MAX_REQUESTS_PER_BOOKING) {
    throw policyError(
      'REQUEST_LIMIT',
      `A booking can have at most ${MAX_REQUESTS_PER_BOOKING} requests. Please contact the operator.`,
    );
  }

  // A preferred trip must be one staff could actually move to (AC-5 with AC-11). A return only
  // request takes only a preferred return trip.
  const preferredScheduleId =
    allowed.leg === BookingLeg.RETURN ? null : (payload.preferredScheduleId ?? null);
  const preferredReturnScheduleId = payload.preferredReturnScheduleId ?? null;
  if (payload.type === BookingRequestType.RESCHEDULE && (preferredScheduleId || preferredReturnScheduleId)) {
    await checkMove(
      prisma,
      booking,
      { outboundScheduleId: preferredScheduleId, returnScheduleId: preferredReturnScheduleId },
      now,
    );
  }
  const isReschedule = payload.type === BookingRequestType.RESCHEDULE;

  try {
    const request = await prisma.bookingRequest.create({
      data: {
        bookingId: booking.id,
        type: payload.type,
        leg: allowed.leg,
        reason: payload.reason?.trim() || null,
        preferredScheduleId: isReschedule ? preferredScheduleId : null,
        preferredReturnScheduleId: isReschedule ? preferredReturnScheduleId : null,
        requestedByUserId: requester.userId,
      },
    });
    // Customer receipt and the ferry owner's heads up, after the row exists (AC-17).
    void BookingEmails.sendRequestReceived(request.id);
    return toRequestView(request);
  } catch (error) {
    // Two creates at once: the one pending partial unique index lets only one through (AC-6).
    if (isUniqueViolation(error)) {
      throw policyError('REQUEST_PENDING', 'This booking already has a request waiting for the operator.');
    }
    throw error;
  }
};

const withdrawRequest = async (
  bookingIdentifier: string,
  requestId: string,
  requester: IBookingRequester,
  now: Date = new Date(),
) => {
  const booking = await findBookingForRequest(bookingIdentifier);
  assertBookingAccess(booking, requester, { allowAdmin: false, action: 'change' });
  if (!booking.requests.some(r => r.id === requestId)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Request not found');
  }

  // Only a still pending request can be withdrawn; staff may have resolved it meanwhile.
  const withdrawn = await prisma.bookingRequest.updateMany({
    where: { id: requestId, bookingId: booking.id, status: BookingRequestStatus.PENDING },
    data: { status: BookingRequestStatus.WITHDRAWN, resolvedAt: now },
  });
  if (withdrawn.count !== 1) {
    throw policyError('REQUEST_NOT_PENDING', 'This request was already handled and can no longer be withdrawn.');
  }

  const request = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: requestId } });
  return toRequestView(request);
};

export const BookingRequestCustomerService = {
  createRequest,
  withdrawRequest,
};
