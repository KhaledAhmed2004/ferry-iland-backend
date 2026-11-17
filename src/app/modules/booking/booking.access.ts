import { StatusCodes } from 'http-status-codes';
import { Prisma } from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { emailsMatch } from './booking.payment';

export type IBookingRequester = {
  userId: string | null;
  role?: string | null;
  email?: string | null;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches a booking by UUID or by its reference, so routes accept either. */
export const bookingIdentifierWhere = (bookingIdentifier: string): Prisma.BookingWhereInput => ({
  OR: [
    ...(UUID_REGEX.test(bookingIdentifier) ? [{ id: bookingIdentifier }] : []),
    { reference: bookingIdentifier },
  ],
});

/**
 * The customer access rule for acting on a booking (spec 0004, AC-16): the signed in owner, or
 * anyone giving the lead passenger email. A signed in user poking at someone else's account
 * booking gets 403; anything else gets 404 so the booking is not revealed.
 * `allowAdmin` lets an admin through as well (cancel); request endpoints are customer only.
 */
export function assertBookingAccess<T extends { userId: string | null; leadPassengerEmail: string }>(
  booking: T | null,
  requester: IBookingRequester,
  options: { allowAdmin: boolean; action: string },
): asserts booking is T {
  if (!booking) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Booking not found');
  }
  const isAdmin = options.allowAdmin && requester.role === 'ADMIN';
  const isOwner = !!booking.userId && !!requester.userId && booking.userId === requester.userId;
  const hasMatchingEmail = emailsMatch(booking.leadPassengerEmail, requester.email);

  if (isAdmin || isOwner || hasMatchingEmail) return;

  if (requester.userId && booking.userId) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      `You are not authorized to ${options.action} this booking`,
    );
  }
  throw new ApiError(StatusCodes.NOT_FOUND, 'Booking not found');
}
