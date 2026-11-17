import crypto from 'crypto';
import { StatusCodes } from 'http-status-codes';
import {
  BoardingStatus,
  BookingRequestStatus,
  BookingStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  RefundReason,
  TripStatus,
  TripType,
} from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { sendRefunds } from '../payment/payment.refund';
import {
  claimBooking,
  getCancellationInfo,
  isWithinFreeCancel,
  policyError,
} from './booking.policy';
import { IBookingRequester, assertBookingAccess, bookingIdentifierWhere } from './booking.access';
import { applyCancellation } from './booking.cancel';
import { BookingEmails } from './booking.email';
import config from '../../../config';
import { DEFAULT_CURRENCY } from '../../../config/stripe';
import { AdminService } from '../admin/admin.service';
import { cancelPaymentIntentAfterCommit } from '../payment/payment.intentCancel';
import { IBookingFilterOptions, ICreateBookingPayload } from './booking.interface';
import {
  PaymentViewer,
  calculateBookingAmounts,
  emailsMatch,
  serializeBooking,
} from './booking.payment';
import { assertValidReturnLeg, resolveTripFare } from './booking.fare';
import { bookingScheduleIds, takeSeats } from './booking.seats';

/** Booking statuses that count as sold seats (spec 0001, AC-6). */
export const SOLD_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
];

/** Statuses a booking may be cancelled from (spec 0001, AC-5). */
const CANCELLABLE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
];

/** Trip statuses that still accept bookings. */
const OPEN_TRIP_STATUSES: TripStatus[] = [
  TripStatus.ON_TIME,
  TripStatus.PREPARING,
  TripStatus.BOARDING,
];

export const isTripOpenForBooking = (status: TripStatus): boolean =>
  OPEN_TRIP_STATUSES.includes(status);

const paymentInclude = { include: { refunds: true } } as const;

export const bookingDetailInclude = {
  tickets: true,
  payment: paymentInclude,
  schedule: {
    include: {
      route: {
        include: {
          departurePort: true,
          destinationPort: true,
        },
      },
      // Routes are shared; the operator running the trip is the ferry's owner.
      ferry: { include: { operator: true } },
    },
  },
  returnSchedule: {
    include: {
      route: {
        include: {
          departurePort: true,
          destinationPort: true,
        },
      },
      ferry: true,
    },
  },
} satisfies Prisma.BookingInclude;

export type { IBookingRequester };

const resolveOperatorProfile = async (userId: string) => {
  const operator = await prisma.operatorProfile.findUnique({
    where: { userId },
  });

  if (!operator) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Operator profile not found for this user',
    );
  }

  return operator;
};

const generateBookingReference = (): string => {
  const todayDateString = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
  const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `FRY-${todayDateString}-${randomSuffix}`;
};

const generateTicketNumber = (
  bookingReference: string,
  passengerIndex: number,
): string => {
  const seatChar = String.fromCharCode(65 + passengerIndex);
  return `TCK-${bookingReference.slice(-4)}-${seatChar}`;
};

const createBooking = async (
  userId: string | null,
  payload: ICreateBookingPayload,
) => {
  const childrenCount = payload.childrenCount ?? 0;
  const totalPassengers = payload.adultsCount + childrenCount;

  // One settings read per booking: commission snapshot and hold length (spec 0001, value sourcing).
  const settings = await AdminService.getOrCreatePlatformSettings();

  const tripType = payload.tripType ?? TripType.ONE_WAY;
  const returnScheduleId =
    tripType === TripType.ONE_WAY ? null : (payload.returnScheduleId ?? null);

  return prisma.$transaction(async transactionClient => {
    const loadOpenSchedule = async (scheduleId: string, isReturn: boolean) => {
      const schedule = await transactionClient.schedule.findUnique({
        where: { id: scheduleId },
        include: {
          route: { include: { departurePort: true } },
          ferry: { select: { operatorId: true } },
        },
      });

      if (!schedule) {
        throw new ApiError(
          StatusCodes.NOT_FOUND,
          isReturn ? 'Selected return trip not found' : 'Selected schedule not found',
        );
      }

      if (!isTripOpenForBooking(schedule.status)) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          isReturn
            ? 'Cannot book tickets on a departed or cancelled return trip'
            : 'Cannot book tickets on a departed or cancelled trip',
        );
      }

      // A trip whose departure time has passed is gone, whatever its status still says
      // (operators often never flip it to DEPARTED).
      if (schedule.departureTime.getTime() <= Date.now()) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          isReturn ? 'The selected return trip has already departed' : 'This trip has already departed',
        );
      }

      // Fast path only. takeSeats below is what actually prevents overselling (AC-4).
      if (schedule.availableSeats < totalPassengers) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          isReturn
            ? 'Not enough available seats on the return trip'
            : 'Not enough available seats on this trip',
        );
      }

      return schedule;
    };

    const targetSchedule = await loadOpenSchedule(payload.scheduleId, false);
    const returnSchedule = returnScheduleId
      ? await loadOpenSchedule(returnScheduleId, true)
      : null;

    assertValidReturnLeg(tripType, targetSchedule, returnSchedule);
    const fare = resolveTripFare(tripType, targetSchedule);

    const seatsTaken = await takeSeats(
      transactionClient,
      bookingScheduleIds({
        scheduleId: targetSchedule.id,
        returnScheduleId,
        adultsCount: payload.adultsCount,
        childrenCount,
      }),
      totalPassengers,
    );

    if (!seatsTaken) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Not enough available seats on this trip',
      );
    }

    const amounts = calculateBookingAmounts({
      adultsCount: payload.adultsCount,
      childrenCount,
      adultFare: fare.adultFare,
      childFare: fare.childFare,
      commissionRate: settings.commissionRate,
    });

    const now = new Date();
    const isFreeBooking = amounts.amountCents === 0;
    const startsPending = config.payments.enabled && !isFreeBooking;
    const bookingReference = generateBookingReference();

    const createdBooking = await transactionClient.booking.create({
      data: {
        reference: bookingReference,
        userId,
        scheduleId: payload.scheduleId,
        tripType,
        returnScheduleId,
        leadPassengerName: payload.leadPassengerName,
        leadPassengerEmail: payload.leadPassengerEmail,
        leadPassengerPhone: payload.leadPassengerPhone,
        adultsCount: payload.adultsCount,
        childrenCount,
        totalAmount: amounts.totalAmount,
        status: startsPending ? BookingStatus.PENDING : BookingStatus.CONFIRMED,
        holdExpiresAt: startsPending
          ? new Date(now.getTime() + settings.seatHoldMinutes * 60 * 1000)
          : null,
        confirmedAt: startsPending ? null : now,
      },
    });

    const ticketRecords = payload.passengers.map((passenger, index) => ({
      bookingId: createdBooking.id,
      ticketNumber: generateTicketNumber(bookingReference, index),
      passengerName: passenger.passengerName,
      nationality: passenger.nationality,
      passportOrId: passenger.passportOrId,
      cabinClass: passenger.cabinClass,
      luggageCount: passenger.luggageCount ?? 0,
      boardingStatus: BoardingStatus.PENDING,
    }));

    await transactionClient.ticket.createMany({
      data: ticketRecords,
    });

    // Never a fake COMPLETED payment: only a zero amount booking (nothing to charge) or
    // the verified Stripe webhook (feature 3) may mark a payment COMPLETED.
    await transactionClient.payment.create({
      data: {
        bookingId: createdBooking.id,
        amountCents: amounts.amountCents,
        currency: DEFAULT_CURRENCY,
        commissionRate: amounts.commissionRate,
        platformCommissionCents: amounts.platformCommissionCents,
        operatorPayoutCents: amounts.operatorPayoutCents,
        provider: startsPending ? PaymentProvider.STRIPE : PaymentProvider.MANUAL,
        status: isFreeBooking ? PaymentStatus.COMPLETED : PaymentStatus.PENDING,
        paidAt: isFreeBooking ? now : null,
      },
    });

    const fullBookingRecord = await transactionClient.booking.findUniqueOrThrow({
      where: { id: createdBooking.id },
      include: bookingDetailInclude,
    });

    return serializeBooking(fullBookingRecord, 'CUSTOMER');
  });
};

/** The customer's booking read: detail plus every request, for the cancellation block. */
const customerBookingInclude = {
  ...bookingDetailInclude,
  requests: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.BookingInclude;

type CustomerBooking = Prisma.BookingGetPayload<{ include: typeof customerBookingInclude }>;

/** Shapes a booking for the customer with its spec 0004 `cancellation` block (AC-4). */
const withCancellation = (
  booking: CustomerBooking,
  viewer: PaymentViewer,
  now: Date = new Date(),
) => {
  const { requests: _requests, ...rest } = booking;
  return {
    ...serializeBooking(rest, viewer),
    cancellation: getCancellationInfo(booking, now),
  };
};

const getMyBookings = async (userId: string) => {
  const bookings = await prisma.booking.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: customerBookingInclude,
  });

  return bookings.map(booking => withCancellation(booking, 'CUSTOMER'));
};

/**
 * Admin, the owning user, or anyone holding the reference plus the lead passenger email
 * may read a booking. Everyone else gets 404, so a reference alone reveals nothing (AC-7).
 */
const getBookingByReference = async (
  reference: string,
  requester: IBookingRequester,
) => {
  const booking = await prisma.booking.findFirst({
    where: bookingIdentifierWhere(reference),
    include: customerBookingInclude,
  });

  const isAdmin = requester.role === 'ADMIN';
  const isOwner =
    !!booking?.userId && !!requester.userId && booking.userId === requester.userId;
  const hasMatchingEmail = emailsMatch(booking?.leadPassengerEmail, requester.email);

  if (!booking || !(isAdmin || isOwner || hasMatchingEmail)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Booking reservation not found');
  }

  return withCancellation(booking, isAdmin ? 'ADMIN' : 'CUSTOMER');
};

/**
 * Spec 0004. A customer cancels on their own up to 24h before the outbound departure and gets
 * the full refundable amount back automatically; inside 24h they must send a request (409
 * REQUEST_REQUIRED). An admin cancels at any time with an ADMIN refund and closes any pending
 * request. A checked in booking is never cancelled (409 BOARDED).
 */
const cancelBooking = async (
  bookingIdentifier: string,
  requester: IBookingRequester,
  now: Date = new Date(),
) => {
  const isAdmin = requester.role === 'ADMIN';

  const { cancelled, intentToCancel, refundIds } = await prisma.$transaction(async transactionClient => {
    const existingBooking = await transactionClient.booking.findFirst({
      where: bookingIdentifierWhere(bookingIdentifier),
      include: {
        payment: { include: { refunds: true } },
        schedule: { select: { departureTime: true } },
      },
    });

    assertBookingAccess(existingBooking, requester, { allowAdmin: true, action: 'cancel' });

    if (existingBooking.status === BookingStatus.CANCELLED) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Booking is already cancelled');
    }

    // The passenger already travelled on this booking, so it is used (spec 0004, AC-8, AC-20).
    if (existingBooking.status === BookingStatus.CHECKED_IN) {
      throw policyError('BOARDED', 'A checked in booking cannot be cancelled');
    }

    if (!CANCELLABLE_BOOKING_STATUSES.includes(existingBooking.status)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `A ${existingBooking.status.toLowerCase().replace('_', ' ')} booking cannot be cancelled`,
      );
    }

    // Inside 24h a customer asks instead; an unpaid hold may always be dropped (AC-2, AC-3).
    if (
      !isAdmin &&
      existingBooking.status === BookingStatus.CONFIRMED &&
      !isWithinFreeCancel(existingBooking.schedule.departureTime, now)
    ) {
      throw policyError(
        'REQUEST_REQUIRED',
        'Your trip is less than 24 hours away. Please send a cancellation or reschedule request instead.',
      );
    }

    // Claim, seats, payment, and the refund row, sent to Stripe after commit (AC-1, AC-13, AC-20).
    const { refundIds } = await applyCancellation(transactionClient, existingBooking, {
      reason: isAdmin ? RefundReason.ADMIN : RefundReason.CUSTOMER_CANCEL,
      actorUserId: requester.userId,
      now,
    });

    // An admin cancel closes the customer's open request (AC-19).
    if (isAdmin) {
      await transactionClient.bookingRequest.updateMany({
        where: { bookingId: existingBooking.id, status: BookingRequestStatus.PENDING },
        data: {
          status: BookingRequestStatus.CANCELLED,
          staffNote: 'Closed: booking cancelled by admin',
          resolvedByUserId: requester.userId,
          resolvedAt: now,
        },
      });
    }

    const cancelledBooking = await transactionClient.booking.findUniqueOrThrow({
      where: { id: existingBooking.id },
      include: { tickets: true, payment: paymentInclude },
    });
    const refund = cancelledBooking.payment?.refunds.find(r => refundIds.includes(r.id));

    return {
      cancelled: {
        ...serializeBooking(cancelledBooking, isAdmin ? 'ADMIN' : 'CUSTOMER'),
        refund: refund
          ? { id: refund.id, amountCents: refund.amountCents, status: refund.status }
          : null,
      },
      refundIds,
      // A PENDING booking's intent is cancelled in Stripe once this commit is final.
      intentToCancel:
        existingBooking.status === BookingStatus.PENDING &&
        existingBooking.payment?.stripePaymentIntentId
          ? existingBooking.payment
          : null,
    };
  });

  if (intentToCancel) {
    // Never throws; a payment that succeeded meanwhile is refunded (CUSTOMER_CANCEL).
    await cancelPaymentIntentAfterCommit(intentToCancel, 'cancel');
  }
  // Never throws; a refund Stripe could not take yet stays PENDING for the sweep.
  await sendRefunds(refundIds);
  // The customer's own cancel with money going back gets an email (spec 0004, AC-17).
  if (!isAdmin && cancelled.refund) {
    void BookingEmails.sendSelfCancelRefund(cancelled.id, cancelled.refund.amountCents);
  }
  return cancelled;
};

const buildBookingSearchWhere = (
  options: IBookingFilterOptions,
): Prisma.BookingWhereInput => {
  if (!options.search) return {};
  return {
    OR: [
      { reference: { contains: options.search, mode: 'insensitive' } },
      { leadPassengerName: { contains: options.search, mode: 'insensitive' } },
      { leadPassengerEmail: { contains: options.search, mode: 'insensitive' } },
    ],
  };
};

const listOperatorBookings = async (
  userId: string,
  options: IBookingFilterOptions,
) => {
  const operator = await resolveOperatorProfile(userId);

  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const skip = (page - 1) * limit;

  const whereClause: Prisma.BookingWhereInput = {
    schedule: {
      ferry: {
        operatorId: operator.id,
      },
    },
    // Unpaid holds and expired holds are hidden unless the operator asks for them (AC-6).
    status: options.status
      ? options.status
      : { notIn: [BookingStatus.PENDING, BookingStatus.EXPIRED] },
    ...buildBookingSearchWhere(options),
  };

  const [bookings, totalCount] = await Promise.all([
    prisma.booking.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        tickets: true,
        payment: paymentInclude,
        schedule: {
          include: {
            route: {
              include: {
                departurePort: true,
                destinationPort: true,
              },
            },
            ferry: true,
          },
        },
      },
    }),
    prisma.booking.count({ where: whereClause }),
  ]);

  const viewer: PaymentViewer = 'OPERATOR';

  return {
    meta: {
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
    data: bookings.map(booking => serializeBooking(booking, viewer)),
  };
};

const checkInBooking = async (userId: string, bookingId: string) => {
  const operator = await resolveOperatorProfile(userId);

  return prisma.$transaction(async transactionClient => {
    const booking = await transactionClient.booking.findUnique({
      where: { id: bookingId },
      include: {
        schedule: {
          include: { ferry: { select: { operatorId: true } } },
        },
      },
    });

    if (
      !booking ||
      booking.schedule.ferry.operatorId !== operator.id
    ) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Booking reservation not found');
    }

    // Only a confirmed (paid or manual) booking can board; an unpaid hold cannot (AC-6).
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Only confirmed bookings can be checked in',
      );
    }

    // Compare and swap, so a concurrent cancel or move cannot interleave (spec 0004, AC-13).
    await claimBooking(transactionClient, booking, { status: BookingStatus.CHECKED_IN });

    await transactionClient.ticket.updateMany({
      where: { bookingId },
      data: { boardingStatus: BoardingStatus.CHECKED_IN },
    });

    // The passenger boarded, so an open change request no longer applies (spec 0004, AC-19).
    await transactionClient.bookingRequest.updateMany({
      where: { bookingId, status: BookingRequestStatus.PENDING },
      data: {
        status: BookingRequestStatus.REJECTED,
        staffNote: 'Closed: passenger checked in',
        resolvedByUserId: userId,
        resolvedAt: new Date(),
      },
    });

    return transactionClient.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { tickets: true },
    });
  });
};

const listAdminBookings = async (options: IBookingFilterOptions) => {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const skip = (page - 1) * limit;

  const whereClause: Prisma.BookingWhereInput = {
    ...(options.status ? { status: options.status } : {}),
    ...buildBookingSearchWhere(options),
  };

  const [bookings, totalCount, statusGroups] = await Promise.all([
    prisma.booking.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: bookingDetailInclude,
    }),
    prisma.booking.count({ where: whereClause }),
    // Per-status totals for the status tabs and KPI cards. They follow the search
    // but ignore the status filter, so every tab shows its own count.
    prisma.booking.groupBy({
      by: ['status'],
      where: buildBookingSearchWhere(options),
      _count: { _all: true },
    }),
  ]);

  const statusCounts = Object.fromEntries(
    Object.values(BookingStatus).map(status => [status, 0]),
  ) as Record<BookingStatus, number>;
  for (const group of statusGroups) {
    statusCounts[group.status] = group._count._all;
  }

  return {
    meta: {
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      statusCounts,
    },
    data: bookings.map(booking => serializeBooking(booking, 'ADMIN')),
  };
};

export const BookingService = {
  createBooking,
  getMyBookings,
  getBookingByReference,
  cancelBooking,
  listOperatorBookings,
  checkInBooking,
  listAdminBookings,
};
