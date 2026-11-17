import { AccountStatus, Role, TripStatus, type User } from '@prisma/client';
import { Secret } from 'jsonwebtoken';
import config from '../../src/config';
import { jwtHelper } from '../../src/helpers/jwtHelper';
import prisma from '../../src/shared/prisma';

export { prisma };

let seq = 0;
/** Short unique suffix for unique columns (emails, port names, registrations). */
export const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Empties every table. Refuses to run unless connected to a *_test database. */
export async function resetDb() {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!db.endsWith('_test')) throw new Error(`resetDb refused: connected to "${db}", not a *_test database`);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const list = tables.map((t) => `"${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  }
}

export async function createUser(role: Role = Role.USER, overrides: Partial<User> = {}) {
  const id = uniq();
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${id}@test.local`,
      passwordHash: 'not-used-in-integration-tests',
      name: `Test ${role} ${id}`,
      role,
      status: AccountStatus.ACTIVE,
      isEmailVerified: true,
      ...overrides,
    },
  });
}

/** A Bearer token backed by a real Session row — the same shape login issues. */
export async function tokenFor(user: User) {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: 'not-used-in-integration-tests',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  return jwtHelper.createToken(
    { id: user.id, sub: user.id, email: user.email, role: user.role, status: user.status, sessionId: session.id },
    config.jwt.jwt_secret as Secret,
    '1h',
  );
}

/** Operator + ports + route + ferry + one bookable schedule. */
export async function createBookableTrip(
  opts: { seats?: number; adultFare?: number; childFare?: number; status?: TripStatus } = {},
) {
  const id = uniq();
  const operatorUser = await createUser(Role.OPERATOR);
  const operator = await prisma.operatorProfile.create({
    data: { userId: operatorUser.id, companyName: `Ferry Co ${id}`, contactPersonName: 'Test Contact' },
  });
  const [from, to] = await Promise.all([
    prisma.port.create({ data: { name: `Port A ${id}` } }),
    prisma.port.create({ data: { name: `Port B ${id}` } }),
  ]);
  const route = await prisma.route.create({
    // Routes are platform wide; the trip's operator is the ferry's owner.
    data: { departurePortId: from.id, destinationPortId: to.id, durationMinutes: 45 },
  });
  const ferry = await prisma.ferry.create({
    data: { operatorId: operator.id, name: `Ferry ${id}`, capacity: 100 },
  });
  const departure = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const schedule = await prisma.schedule.create({
    data: {
      routeId: route.id,
      ferryId: ferry.id,
      departureTime: departure,
      arrivalTime: new Date(departure.getTime() + 45 * 60 * 1000),
      adultFare: opts.adultFare ?? 40,
      childFare: opts.childFare ?? 20,
      availableSeats: opts.seats ?? 10,
      status: opts.status ?? TripStatus.ON_TIME,
    },
  });
  return { operatorUser, operator, route, ferry, schedule };
}

/** Valid POST /bookings body: `adults` + `children` passengers, one passenger record each. */
export function bookingPayload(
  scheduleId: string,
  { adults = 1, children = 0, email = `lead-${uniq()}@test.local` } = {},
) {
  const passengers = Array.from({ length: adults + children }, (_, i) => ({
    passengerName: `Passenger ${i + 1}`,
    nationality: 'MV',
    passportOrId: `ID${1000 + i}`,
  }));
  return {
    scheduleId,
    leadPassengerName: 'Lead Passenger',
    leadPassengerEmail: email,
    adultsCount: adults,
    childrenCount: children,
    passengers,
  };
}

type BookableTrip = Awaited<ReturnType<typeof createBookableTrip>>;

/**
 * Turns a bookable trip into a round trip offer (spec 0004 tests): gives the outbound a bundle
 * fare and adds a return on the reverse route with the same ferry, leaving `returnInHours` from
 * now. `bundle: 'ROUND_TRIP' | 'SAME_DAY_RETURN'` picks which bundle fare the outbound offers.
 */
export async function addReturnLeg(
  trip: BookableTrip,
  { returnInHours, seats = 10, bundle = 'ROUND_TRIP' as 'ROUND_TRIP' | 'SAME_DAY_RETURN' },
) {
  await prisma.schedule.update({
    where: { id: trip.schedule.id },
    data:
      bundle === 'ROUND_TRIP'
        ? { adultRoundTripFare: 70, childRoundTripFare: 35 }
        : { adultSameDayFare: 60, childSameDayFare: 30 },
  });
  const reverseRoute = await prisma.route.create({
    data: {
      departurePortId: trip.route.destinationPortId,
      destinationPortId: trip.route.departurePortId,
      durationMinutes: 45,
    },
  });
  const departure = new Date(Date.now() + returnInHours * 60 * 60 * 1000);
  const returnSchedule = await prisma.schedule.create({
    data: {
      routeId: reverseRoute.id,
      ferryId: trip.ferry.id,
      departureTime: departure,
      arrivalTime: new Date(departure.getTime() + 45 * 60 * 1000),
      adultFare: 40,
      childFare: 20,
      availableSeats: seats,
    },
  });
  return { reverseRoute, returnSchedule };
}

export const seatsLeft = async (scheduleId: string) =>
  (await prisma.schedule.findUniqueOrThrow({ where: { id: scheduleId } })).availableSeats;

/** Every path in `value` whose key is in `forbidden` (deep). */
export function findKeysDeep(value: unknown, forbidden: string[], path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findKeysDeep(v, forbidden, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(forbidden.includes(k) ? [`${path}.${k}`] : []),
      ...findKeysDeep(v, forbidden, `${path}.${k}`),
    ]);
  }
  return [];
}
