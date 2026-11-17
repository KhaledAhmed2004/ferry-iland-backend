import { StatusCodes } from 'http-status-codes';
import { BookingRequestStatus, BookingStatus, Prisma, RefundReason } from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { USER_ROLES } from '../../../enums/user';
import { sendRefunds } from '../payment/payment.refund';
import { applyCancellation } from '../booking/booking.cancel';
import { policyError, refundableCents, toRequestView } from '../booking/booking.policy';
import { serializeBooking, viewerFromRole } from '../booking/booking.payment';
import { applyMove, bookingForMoveInclude } from '../booking/booking.move';
import { BookingEmails } from '../booking/booking.email';
import {
  IBookingRequestListQuery,
  IResolveBookingRequestPayload,
  IStaffActor,
} from './bookingRequest.interface';

/**
 * Spec 0004: the staff side of change requests. The operator who owns the outbound ferry (not the
 * route) or any admin lists requests and resolves them by cancelling with a full refund, by moving
 * the booking to other trips through the shared move service, or by rejecting with a note.
 */

/** Operators see only requests on their own ferries; admins see all (AC-7, AC-16). */
const scopeWhere = async (actor: IStaffActor): Promise<Prisma.BookingRequestWhereInput> => {
  if (actor.role === USER_ROLES.ADMIN) return {};
  const operator = await prisma.operatorProfile.findUnique({ where: { userId: actor.userId } });
  if (!operator) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Operator profile not found for this user');
  }
  return { booking: { schedule: { ferry: { operatorId: operator.id } } } };
};

const legInclude = {
  include: {
    route: { include: { departurePort: true, destinationPort: true } },
    ferry: { select: { name: true } },
  },
} as const;

const listInclude = {
  booking: {
    include: {
      payment: { include: { refunds: true } },
      schedule: legInclude,
      returnSchedule: legInclude,
    },
  },
  preferredSchedule: legInclude,
  preferredReturnSchedule: legInclude,
} satisfies Prisma.BookingRequestInclude;

type ListedRequest = Prisma.BookingRequestGetPayload<{ include: typeof listInclude }>;
type LegSchedule = NonNullable<ListedRequest['preferredSchedule']>;

const legView = (schedule: LegSchedule) => ({
  scheduleId: schedule.id,
  departureTime: schedule.departureTime,
  arrivalTime: schedule.arrivalTime,
  ferryName: schedule.ferry.name,
  departurePort: {
    name: schedule.route.departurePort.name,
  },
  destinationPort: {
    name: schedule.route.destinationPort.name,
  },
});

/** The spec's request list item. */
const toListItem = (request: ListedRequest, now: Date) => {
  const { booking } = request;
  return {
    ...toRequestView(request),
    // Departed while still waiting: stays listed so staff can still act on it (AC-7).
    overdue:
      request.status === BookingRequestStatus.PENDING &&
      booking.schedule.departureTime.getTime() < now.getTime(),
    preferredSchedule: request.preferredSchedule ? legView(request.preferredSchedule) : null,
    preferredReturnSchedule: request.preferredReturnSchedule
      ? legView(request.preferredReturnSchedule)
      : null,
    booking: {
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      leadPassengerName: booking.leadPassengerName,
      leadPassengerEmail: booking.leadPassengerEmail,
      passengers: booking.adultsCount + booking.childrenCount,
      adultsCount: booking.adultsCount,
      childrenCount: booking.childrenCount,
      tripType: booking.tripType,
      totalAmount: Number(booking.totalAmount),
      currency: booking.payment?.currency ?? null,
      paymentStatus: booking.payment?.status ?? null,
      // What a CANCEL resolution would refund right now (value sourcing: refundCents).
      refundCents: refundableCents(booking.payment),
      outbound: legView(booking.schedule),
      return: booking.returnSchedule ? legView(booking.returnSchedule) : null,
    },
  };
};

const listRequests = async (
  actor: IStaffActor,
  query: IBookingRequestListQuery,
  now: Date = new Date(),
) => {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const scope = await scopeWhere(actor);
  const where: Prisma.BookingRequestWhereInput = {
    ...scope,
    ...(query.status ? { status: query.status } : {}),
  };

  const [requests, total, pendingCount] = await Promise.all([
    prisma.bookingRequest.findMany({
      where,
      include: listInclude,
      // The pending list is a work queue, oldest first; resolved history reads newest first.
      orderBy: { createdAt: query.status === BookingRequestStatus.PENDING ? 'asc' : 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.bookingRequest.count({ where }),
    // Same scope, ignoring the status filter, for the tab badge (AC-7).
    prisma.bookingRequest.count({ where: { ...scope, status: BookingRequestStatus.PENDING } }),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit), pendingCount },
    data: requests.map(request => toListItem(request, now)),
  };
};

const RESOLVED_STATUS = {
  CANCEL: BookingRequestStatus.CANCELLED,
  RESCHEDULE: BookingRequestStatus.RESCHEDULED,
  REJECT: BookingRequestStatus.REJECTED,
} as const;

const resolveRequest = async (
  actor: IStaffActor,
  requestId: string,
  payload: IResolveBookingRequestPayload,
  now: Date = new Date(),
) => {
  const scope = await scopeWhere(actor);

  const { refundIds } = await prisma.$transaction(async tx => {
    const request = await tx.bookingRequest.findFirst({
      where: { id: requestId, ...scope },
      include: {
        booking: { include: { payment: { include: { refunds: true } }, ...bookingForMoveInclude } },
      },
    });
    // Another operator's request looks like it does not exist (AC-16).
    if (!request) throw new ApiError(StatusCodes.NOT_FOUND, 'Request not found');

    if (request.status !== BookingRequestStatus.PENDING) {
      throw policyError('REQUEST_NOT_PENDING', 'This request was already handled.');
    }

    const { booking } = request;
    if (payload.action === 'CANCEL') {
      if (booking.status === BookingStatus.CHECKED_IN) {
        throw policyError('BOARDED', 'A checked in booking cannot be cancelled');
      }
      if (booking.status !== BookingStatus.CONFIRMED) {
        throw policyError('REQUEST_NOT_ALLOWED', 'This booking can no longer be cancelled');
      }
    }

    // Two staff resolving at once: only the first moves the request out of PENDING (AC-13).
    const transitioned = await tx.bookingRequest.updateMany({
      where: { id: request.id, status: BookingRequestStatus.PENDING },
      data: {
        status: RESOLVED_STATUS[payload.action],
        staffNote: payload.note?.trim() || null,
        resolvedByUserId: actor.userId,
        resolvedAt: now,
      },
    });
    if (transitioned.count !== 1) {
      throw policyError('REQUEST_NOT_PENDING', 'This request was already handled.');
    }

    // Cancel works after departure too: the operator may approve a late ask (AC-8).
    if (payload.action === 'CANCEL') {
      return applyCancellation(tx, booking, {
        reason: RefundReason.CUSTOMER_CANCEL,
        actorUserId: actor.userId,
        now,
      });
    }
    // Staff may answer any request with a move, whatever the customer asked for (AC-9).
    if (payload.action === 'RESCHEDULE') {
      await applyMove(
        tx,
        booking,
        {
          outboundScheduleId: payload.outboundScheduleId,
          returnScheduleId: payload.returnScheduleId,
        },
        { actorUserId: actor.userId, requestId: request.id, reason: payload.note, now },
      );
    }
    return { refundIds: [] as string[] };
  });

  // Never throws; a refund Stripe could not take yet stays PENDING for the sweep.
  await sendRefunds(refundIds);

  const resolved = await prisma.bookingRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { booking: { include: { tickets: true, payment: { include: { refunds: true } } } } },
  });
  const refund = resolved.booking.payment?.refunds.find(r => refundIds.includes(r.id));
  // Any outcome, with the staff note, after commit (AC-17).
  void BookingEmails.sendRequestResolved(requestId, refund?.amountCents ?? 0);

  return {
    request: toRequestView(resolved),
    booking: serializeBooking(resolved.booking, viewerFromRole(actor.role)),
    refund: refund ? { id: refund.id, amountCents: refund.amountCents, status: refund.status } : null,
  };
};

export const BookingRequestService = {
  listRequests,
  resolveRequest,
};
