import { StatusCodes } from 'http-status-codes';
import { Ferry, Route, Schedule, TripType } from '@prisma/client';
import ApiError from '../../../errors/ApiError';

/**
 * Trip type pricing and return leg rules (plan 2026-11-05-trip-type-round-trip-same-day).
 * One way uses the schedule fares. Round trip and same day return use the bundle fares the
 * operator set on the outbound schedule; a null bundle fare means the option is not offered.
 */

type ScheduleWithRoute = Pick<
  Schedule,
  | 'id'
  | 'departureTime'
  | 'arrivalTime'
  | 'adultFare'
  | 'childFare'
  | 'adultRoundTripFare'
  | 'childRoundTripFare'
  | 'adultSameDayFare'
  | 'childSameDayFare'
> & {
  // The trip's operator is its ferry's operator (routes are shared across operators).
  ferry: Pick<Ferry, 'operatorId'>;
  route: Pick<Route, 'departurePortId' | 'destinationPortId'>;
};

export type IFarePerPassenger = { adultFare: number; childFare: number };

/** Search uses kebab case query values; bookings use the Prisma enum. */
export const SEARCH_TRIP_TYPE_TO_ENUM = {
  'one-way': TripType.ONE_WAY,
  'round-trip': TripType.ROUND_TRIP,
  'same-day-return': TripType.SAME_DAY_RETURN,
} as const;

/** Per passenger fare for the trip type, or null when the route does not offer it. */
export const getFarePerPassenger = (
  tripType: TripType,
  outbound: ScheduleWithRoute,
): IFarePerPassenger | null => {
  if (tripType === TripType.ONE_WAY) {
    return { adultFare: outbound.adultFare, childFare: outbound.childFare };
  }

  const adultFare =
    tripType === TripType.ROUND_TRIP ? outbound.adultRoundTripFare : outbound.adultSameDayFare;
  const childFare =
    tripType === TripType.ROUND_TRIP ? outbound.childRoundTripFare : outbound.childSameDayFare;

  if (adultFare === null || adultFare === undefined) return null;
  return { adultFare, childFare: childFare ?? adultFare };
};

/** A leg's departure calendar date (UTC, `YYYY-MM-DD`). */
const legDate = (leg: ScheduleWithRoute) => leg.departureTime.toISOString().slice(0, 10);

/** Throws 400 when the return leg does not fit the outbound leg for this trip type. */
export const assertValidReturnLeg = (
  tripType: TripType,
  outbound: ScheduleWithRoute,
  returnLeg: ScheduleWithRoute | null,
): void => {
  if (tripType === TripType.ONE_WAY) {
    if (returnLeg) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'A one way booking cannot have a return trip');
    }
    return;
  }

  if (!returnLeg) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Please select a return trip');
  }

  const isReverseRoute =
    returnLeg.route.departurePortId === outbound.route.destinationPortId &&
    returnLeg.route.destinationPortId === outbound.route.departurePortId;
  if (!isReverseRoute) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'The return trip must go back the opposite way of the outbound trip',
    );
  }

  if (returnLeg.ferry.operatorId !== outbound.ferry.operatorId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'The return trip must be with the same ferry operator',
    );
  }

  if (returnLeg.departureTime.getTime() < outbound.arrivalTime.getTime()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'The return trip must leave after the outbound trip arrives',
    );
  }

  if (
    tripType === TripType.SAME_DAY_RETURN &&
    legDate(returnLeg) !== legDate(outbound)
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'A same day return must come back on the same day',
    );
  }
};

/** Fare for a valid trip, or 400 when the route does not offer this trip type. */
export const resolveTripFare = (
  tripType: TripType,
  outbound: ScheduleWithRoute,
): IFarePerPassenger => {
  const fare = getFarePerPassenger(tripType, outbound);
  if (!fare) {
    const label = tripType === TripType.ROUND_TRIP ? 'Round trip' : 'Same day return';
    throw new ApiError(StatusCodes.BAD_REQUEST, `${label} is not offered on this trip`);
  }
  return fare;
};
