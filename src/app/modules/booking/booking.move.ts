import { StatusCodes } from 'http-status-codes';
import {
  BookingLeg,
  BookingRequestStatus,
  BookingStatus,
  Prisma,
  TripType,
} from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { USER_ROLES } from '../../../enums/user';
import {
  BookingSnapshot,
  claimBooking,
  isWithinMoveWindow,
  policyError,
} from './booking.policy';
import { IBookingRequester, assertBookingAccess, bookingIdentifierWhere } from './booking.access';
import { assertValidReturnLeg, getFarePerPassenger } from './booking.fare';
import { bookingSeatCount, takeSeats } from './booking.seats';
import { bookingDetailInclude, isTripOpenForBooking } from './booking.service';
import { serializeBooking, viewerFromRole } from './booking.payment';
import { BookingEmails } from './booking.email';

/**
 * Spec 0004: the one move service. A staff resolved RESCHEDULE request, a direct staff move
 * (for example a no show), the move options picker, and the customer's preferred trip check all
 * run the same rules (AC-11, AC-12), so a booking can never land on a trip it could not have
 * been booked on. A move keeps ticket numbers, the price, and the payment (AC-13, AC-14).
 */

type Db = Prisma.TransactionClient | typeof prisma;

const moveScheduleInclude = {
  route: { include: { departurePort: true, destinationPort: true } },
  ferry: { select: { operatorId: true, name: true } },
} satisfies Prisma.ScheduleInclude;

type MoveSchedule = Prisma.ScheduleGetPayload<{ include: typeof moveScheduleInclude }>;

export const bookingForMoveInclude = {
  schedule: { include: moveScheduleInclude },
  returnSchedule: { include: moveScheduleInclude },
} satisfies Prisma.BookingInclude;

export type BookingForMove = Prisma.BookingGetPayload<{ include: typeof bookingForMoveInclude }>;

export type IMoveTargets = {
  outboundScheduleId?: string | null;
  returnScheduleId?: string | null;
};

export type IMoveOptions = {
  actorUserId: string | null;
  /** The request this move resolves; null for a direct move. */
  requestId: string | null;
  reason?: string | null;
  now: Date;
};

const notAllowed = (message: string) => policyError('MOVE_NOT_ALLOWED', message);

const currentLeg = (booking: BookingForMove, leg: BookingLeg): MoveSchedule | null =>
  leg === BookingLeg.OUTBOUND ? booking.schedule : booking.returnSchedule;

/** AC-12: which legs may move at all, and until when. */
export const assertLegMovable = (booking: BookingForMove, leg: BookingLeg, now: Date): MoveSchedule => {
  if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.EXPIRED) {
    throw notAllowed(`A ${booking.status.toLowerCase()} booking cannot be moved`);
  }
  if (booking.status === BookingStatus.PENDING) {
    throw notAllowed('An unpaid booking cannot be moved');
  }
  if (leg === BookingLeg.OUTBOUND && booking.status === BookingStatus.CHECKED_IN) {
    throw policyError('BOARDED', 'The outbound trip was already boarded, so it cannot be moved');
  }
  const schedule = currentLeg(booking, leg);
  if (!schedule) {
    throw notAllowed('This booking has no return trip to move');
  }
  if (!isWithinMoveWindow(schedule.departureTime, now)) {
    throw notAllowed('This trip left more than 24 hours ago, so it can no longer be moved');
  }
  return schedule;
};

/** AC-11 for one leg: the reason the target is not allowed, or null when it is. */
const targetProblem = (
  current: MoveSchedule,
  target: MoveSchedule,
  seats: number,
  now: Date,
): string | null => {
  if (target.id === current.id) return 'The new trip must be a different trip';
  if (target.routeId !== current.routeId) return 'The new trip must be on the same route';
  if (target.ferry.operatorId !== current.ferry.operatorId) {
    return 'The new trip must be with the same ferry operator';
  }
  if (!isTripOpenForBooking(target.status) || target.departureTime.getTime() <= now.getTime()) {
    return 'The new trip is no longer open for booking';
  }
  if (target.availableSeats < seats) return 'The new trip does not have enough seats';
  return null;
};

/**
 * AC-11 for the booking as a whole after the move: the return still fits the outbound, and the
 * outbound still offers the bundle fare the booking was sold at.
 */
const bookingProblem = (
  tripType: TripType,
  outbound: MoveSchedule,
  returnLeg: MoveSchedule | null,
): string | null => {
  try {
    assertValidReturnLeg(tripType, outbound, returnLeg);
  } catch (error) {
    if (error instanceof ApiError) return error.message;
    throw error;
  }
  if (tripType !== TripType.ONE_WAY && !getFarePerPassenger(tripType, outbound)) {
    return tripType === TripType.ROUND_TRIP
      ? 'The new trip does not offer the round trip fare'
      : 'The new trip does not offer the same day return fare';
  }
  return null;
};

const loadTarget = async (db: Db, scheduleId: string): Promise<MoveSchedule> => {
  const target = await db.schedule.findUnique({
    where: { id: scheduleId },
    include: moveScheduleInclude,
  });
  if (!target) throw notAllowed('The new trip was not found');
  return target;
};

type CheckedMove = {
  legs: { leg: BookingLeg; from: MoveSchedule; to: MoveSchedule }[];
};

/**
 * Checks every rule for moving the given legs (AC-11, AC-12) and returns what would change.
 * Read only; `applyMove` repeats it inside the transaction before changing anything.
 */
export const checkMove = async (
  db: Db,
  booking: BookingForMove,
  targets: IMoveTargets,
  now: Date,
): Promise<CheckedMove> => {
  const seats = bookingSeatCount(booking);
  const legs: CheckedMove['legs'] = [];

  const requested: [BookingLeg, string | null | undefined][] = [
    [BookingLeg.OUTBOUND, targets.outboundScheduleId],
    [BookingLeg.RETURN, targets.returnScheduleId],
  ];
  for (const [leg, scheduleId] of requested) {
    if (!scheduleId) continue;
    const from = assertLegMovable(booking, leg, now);
    const to = await loadTarget(db, scheduleId);
    const problem = targetProblem(from, to, seats, now);
    if (problem) throw notAllowed(problem);
    legs.push({ leg, from, to });
  }
  if (legs.length === 0) throw notAllowed('Choose a new trip for at least one leg');

  const outbound = legs.find(l => l.leg === BookingLeg.OUTBOUND)?.to ?? booking.schedule;
  const returnLeg = legs.find(l => l.leg === BookingLeg.RETURN)?.to ?? booking.returnSchedule;
  const problem = bookingProblem(booking.tripType, outbound, returnLeg);
  if (problem) throw notAllowed(problem);

  return { legs };
};

/**
 * Moves the legs inside the caller's transaction (AC-13): claim the booking by compare and swap,
 * take seats on the new trips, give them back on the old ones, point the booking at the new
 * trips, and write one BookingChange per moved leg. No money moves.
 */
export const applyMove = async (
  tx: Prisma.TransactionClient,
  booking: BookingForMove,
  targets: IMoveTargets,
  options: IMoveOptions,
) => {
  const { legs } = await checkMove(tx, booking, targets, options.now);
  const seats = bookingSeatCount(booking);

  const snapshot: BookingSnapshot = booking;
  const newOutbound = legs.find(l => l.leg === BookingLeg.OUTBOUND)?.to.id ?? booking.scheduleId;
  const newReturn = legs.find(l => l.leg === BookingLeg.RETURN)?.to.id ?? booking.returnScheduleId;
  await claimBooking(tx, snapshot, { scheduleId: newOutbound, returnScheduleId: newReturn });

  // takeSeats is the real seat guard; the read above was a fast check only.
  const seatsTaken = await takeSeats(tx, legs.map(l => l.to.id), seats);
  if (!seatsTaken) throw notAllowed('The new trip does not have enough seats');

  for (const { from } of legs) {
    await tx.schedule.update({
      where: { id: from.id },
      data: { availableSeats: { increment: seats } },
    });
  }

  const reason = options.reason?.trim() || null;
  const changes = [];
  for (const { leg, from, to } of legs) {
    changes.push(
      await tx.bookingChange.create({
        data: {
          bookingId: booking.id,
          leg,
          fromScheduleId: from.id,
          toScheduleId: to.id,
          requestId: options.requestId,
          changedByUserId: options.actorUserId,
          reason,
        },
      }),
    );
  }
  return changes;
};

export type IStaffMoveActor = { userId: string; role: string };

/** The operator who owns the booking's outbound ferry, or any admin (AC-16). */
const isStaffInScope = async (actor: IBookingRequester, booking: BookingForMove): Promise<boolean> => {
  if (actor.role === USER_ROLES.ADMIN) return true;
  if (actor.role !== USER_ROLES.OPERATOR || !actor.userId) return false;
  const operator = await prisma.operatorProfile.findUnique({ where: { userId: actor.userId } });
  return !!operator && booking.schedule.ferry.operatorId === operator.id;
};

const findBookingForMove = (db: Db, bookingIdentifier: string) =>
  db.booking.findFirst({
    where: bookingIdentifierWhere(bookingIdentifier),
    include: bookingForMoveInclude,
  });

/** How many trips the picker lists at most. */
const MOVE_OPTIONS_LIMIT = 50;

/**
 * AC-15: exactly the trips a leg may move to, for the staff picker and the customer's preferred
 * trip picker. Staff in scope, or the customer under the cancel access rule.
 */
const listMoveOptions = async (
  bookingIdentifier: string,
  leg: BookingLeg,
  requester: IBookingRequester,
  now: Date = new Date(),
) => {
  const booking = await findBookingForMove(prisma, bookingIdentifier);
  if (!booking) throw new ApiError(StatusCodes.NOT_FOUND, 'Booking not found');
  if (!(await isStaffInScope(requester, booking))) {
    assertBookingAccess(booking, requester, { allowAdmin: true, action: 'view' });
  }

  const current = assertLegMovable(booking, leg, now);
  const seats = bookingSeatCount(booking);

  const candidates = await prisma.schedule.findMany({
    where: {
      id: { not: current.id },
      routeId: current.routeId,
      ferry: { operatorId: current.ferry.operatorId },
      departureTime: { gt: now },
      availableSeats: { gte: seats },
    },
    include: moveScheduleInclude,
    orderBy: { departureTime: 'asc' },
    take: MOVE_OPTIONS_LIMIT * 2,
  });

  return candidates
    .filter(target => {
      if (targetProblem(current, target, seats, now)) return false;
      const outbound = leg === BookingLeg.OUTBOUND ? target : booking.schedule;
      const returnLeg = leg === BookingLeg.RETURN ? target : booking.returnSchedule;
      return bookingProblem(booking.tripType, outbound, returnLeg) === null;
    })
    .slice(0, MOVE_OPTIONS_LIMIT)
    .map(target => ({
      scheduleId: target.id,
      departureTime: target.departureTime,
      arrivalTime: target.arrivalTime,
      ferryName: target.ferry.name,
      availableSeats: target.availableSeats,
    }));
};

/**
 * Direct staff move (POST /bookings/:idOrReference/move). Closes an open request as
 * RESCHEDULED in the same transaction (AC-19).
 */
const moveBooking = async (
  actor: IStaffMoveActor,
  bookingIdentifier: string,
  payload: IMoveTargets & { reason?: string },
  now: Date = new Date(),
) => {
  const bookingId = await prisma.$transaction(async tx => {
    const booking = await findBookingForMove(tx, bookingIdentifier);
    // Another operator's booking looks like it does not exist (AC-16).
    if (!booking || !(await isStaffInScope(actor, booking))) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Booking not found');
    }

    await applyMove(tx, booking, payload, {
      actorUserId: actor.userId,
      requestId: null,
      reason: payload.reason,
      now,
    });

    await tx.bookingRequest.updateMany({
      where: { bookingId: booking.id, status: BookingRequestStatus.PENDING },
      data: {
        status: BookingRequestStatus.RESCHEDULED,
        staffNote: 'Closed: booking moved',
        resolvedByUserId: actor.userId,
        resolvedAt: now,
      },
    });
    return booking.id;
  });

  // After commit; a mail problem never undoes the move (AC-17).
  void BookingEmails.sendBookingMoved(bookingId, payload.reason);
  return bookingWithChanges(bookingId, actor.role);
};

/** The booking after a move, with its full change history, newest first. */
export const bookingWithChanges = async (bookingId: string, role: string) => {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { ...bookingDetailInclude, changes: { orderBy: { createdAt: 'desc' } } },
  });
  const { changes, ...rest } = booking;
  return { ...serializeBooking(rest, viewerFromRole(role)), changes };
};

export const BookingMoveService = {
  listMoveOptions,
  moveBooking,
};
