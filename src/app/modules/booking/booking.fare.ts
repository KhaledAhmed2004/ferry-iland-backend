import { StatusCodes } from 'http-status-codes';
import { Route, Schedule, TripType, Port } from '@prisma/client';
import ApiError from '../../../errors/ApiError';
import { localDate } from '../../../shared/portTime';

/**
 * Trip type pricing and return leg rules (plan 2026-11-05-trip-type-round-trip-same-day).
 * One way uses the schedule fares. Round trip and same day return use the bundle fares stored
 * on the outbound route (client fare matrix); a null bundle fare means the option is not offered.
 */

type ScheduleWithRoute = Pick<
  Schedule,
  'id' | 'departureTime' | 'arrivalTime' | 'adultFare' | 'childFare'
> & {
  route: Pick<
    Route,
    | 'operatorId'
    | 'departurePortId'
    | 'destinationPortId'
    | 'adultRoundTripFare'
    | 'childRoundTripFare'
    | 'adultSameDayFare'
    | 'childSameDayFare'
  > & { departurePort: Pick<Port, 'timeZone'> };
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

  const { route } = outbound;
  const adultFare =
    tripType === TripType.ROUND_TRIP ? route.adultRoundTripFare : route.adultSameDayFare;
  const childFare =
    tripType === TripType.ROUND_TRIP ? route.childRoundTripFare : route.childSameDayFare;

  if (adultFare === null || adultFare === undefined) return null;
  return { adultFare, childFare: childFare ?? adultFare };
};

/** A leg's departure date at its own departure port (spec 0003, AC-9). */
const legLocalDate = (leg: ScheduleWithRoute) =>
  localDate(leg.departureTime, leg.route.departurePort.timeZone);

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

  if (returnLeg.route.operatorId !== outbound.route.operatorId) {
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
    legLocalDate(returnLeg) !== legLocalDate(outbound)
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
    throw new ApiError(StatusCodes.BAD_REQUEST, `${label} is not offered on this route`);
  }
  return fare;
};
