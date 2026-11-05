import { describe, expect, it, vi } from 'vitest';
import { TripType } from '@prisma/client';
import {
  assertValidReturnLeg,
  getFarePerPassenger,
  resolveTripFare,
} from '../booking.fare';
import { releaseBookingSeats, takeSeats } from '../booking.seats';

const SABA = 'port-saba';
const STATIA = 'port-statia';

const leg = (overrides: {
  id?: string;
  from?: string;
  to?: string;
  operatorId?: string;
  departure: string;
  arrival: string;
  roundTrip?: [number | null, number | null];
  sameDay?: [number | null, number | null];
}) => ({
  id: overrides.id ?? 'schedule',
  departureTime: new Date(overrides.departure),
  arrivalTime: new Date(overrides.arrival),
  adultFare: 61.5,
  childFare: 46.5,
  route: {
    operatorId: overrides.operatorId ?? 'op-1',
    departurePortId: overrides.from ?? SABA,
    destinationPortId: overrides.to ?? STATIA,
    adultRoundTripFare: overrides.roundTrip?.[0] ?? null,
    childRoundTripFare: overrides.roundTrip?.[1] ?? null,
    adultSameDayFare: overrides.sameDay?.[0] ?? null,
    childSameDayFare: overrides.sameDay?.[1] ?? null,
    departurePort: { timeZone: 'America/Kralendijk' },
  },
});

// Saba -> Statia from the client matrix: RT 103/78, OW 61.50/46.50, same day 94/72.
const outbound = leg({
  departure: '2026-11-10T08:30:00.000Z',
  arrival: '2026-11-10T09:15:00.000Z',
  roundTrip: [103, 78],
  sameDay: [94, 72],
});
const sameDayBack = leg({
  id: 'return',
  from: STATIA,
  to: SABA,
  departure: '2026-11-10T14:15:00.000Z',
  arrival: '2026-11-10T15:00:00.000Z',
});

describe('Trip type fares', () => {
  it('one way uses the schedule fares', () => {
    expect(getFarePerPassenger(TripType.ONE_WAY, outbound)).toEqual({
      adultFare: 61.5,
      childFare: 46.5,
    });
  });

  it('round trip and same day return use the route bundle fares', () => {
    expect(getFarePerPassenger(TripType.ROUND_TRIP, outbound)).toEqual({
      adultFare: 103,
      childFare: 78,
    });
    expect(getFarePerPassenger(TripType.SAME_DAY_RETURN, outbound)).toEqual({
      adultFare: 94,
      childFare: 72,
    });
  });

  it('a route without the bundle fare does not offer it (400)', () => {
    const noSameDay = leg({ ...outbound, departure: '2026-11-10T08:30:00.000Z', arrival: '2026-11-10T09:15:00.000Z', roundTrip: [103, 78] });
    expect(getFarePerPassenger(TripType.SAME_DAY_RETURN, noSameDay)).toBeNull();
    expect(() => resolveTripFare(TripType.SAME_DAY_RETURN, noSameDay)).toThrow(
      'Same day return is not offered on this route',
    );
  });
});

describe('Return leg rules', () => {
  it('accepts a valid same day return', () => {
    expect(() =>
      assertValidReturnLeg(TripType.SAME_DAY_RETURN, outbound, sameDayBack),
    ).not.toThrow();
  });

  it('one way must not have a return leg', () => {
    expect(() => assertValidReturnLeg(TripType.ONE_WAY, outbound, sameDayBack)).toThrow(
      'A one way booking cannot have a return trip',
    );
  });

  it('round trip needs a return leg', () => {
    expect(() => assertValidReturnLeg(TripType.ROUND_TRIP, outbound, null)).toThrow(
      'Please select a return trip',
    );
  });

  it('rejects a return that does not go back the opposite way', () => {
    const sameDirection = { ...sameDayBack, route: { ...sameDayBack.route, departurePortId: SABA, destinationPortId: STATIA } };
    expect(() =>
      assertValidReturnLeg(TripType.ROUND_TRIP, outbound, sameDirection),
    ).toThrow('opposite way');
  });

  it('rejects a return with another operator', () => {
    const otherOperator = { ...sameDayBack, route: { ...sameDayBack.route, operatorId: 'op-2' } };
    expect(() =>
      assertValidReturnLeg(TripType.ROUND_TRIP, outbound, otherOperator),
    ).toThrow('same ferry operator');
  });

  it('rejects a return that leaves before the outbound arrives', () => {
    const tooEarly = { ...sameDayBack, departureTime: new Date('2026-11-10T09:00:00.000Z') };
    expect(() => assertValidReturnLeg(TripType.ROUND_TRIP, outbound, tooEarly)).toThrow(
      'after the outbound trip arrives',
    );
  });

  it('same day return must come back the same day; round trip may not', () => {
    const nextDay = { ...sameDayBack, departureTime: new Date('2026-11-11T14:15:00.000Z') };
    expect(() =>
      assertValidReturnLeg(TripType.SAME_DAY_RETURN, outbound, nextDay),
    ).toThrow('same day');
    expect(() => assertValidReturnLeg(TripType.ROUND_TRIP, outbound, nextDay)).not.toThrow();
  });

  it('same day means the same local day at each departure port, not the UTC day (spec 0003, AC-9)', () => {
    // 21:00 AST on 10 Nov is 01:00Z on 11 Nov: still the same local day as an 04:30 AST outbound.
    const lateSameDay = {
      ...sameDayBack,
      departureTime: new Date('2026-11-11T01:00:00.000Z'),
      arrivalTime: new Date('2026-11-11T01:45:00.000Z'),
    };
    expect(() =>
      assertValidReturnLeg(TripType.SAME_DAY_RETURN, outbound, lateSameDay),
    ).not.toThrow();
  });
});

describe('Seats on both legs', () => {
  const fakeTx = (seatsById: Record<string, number>) => {
    const schedule = {
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (seatsById[where.id] < where.availableSeats.gte) return { count: 0 };
        seatsById[where.id] -= data.availableSeats.decrement;
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        seatsById[where.id] += data.availableSeats.increment;
      }),
    };
    return { schedule } as any;
  };

  it('takes seats on both schedules', async () => {
    const seats = { out: 10, back: 10 };
    expect(await takeSeats(fakeTx(seats), ['out', 'back'], 3)).toBe(true);
    expect(seats).toEqual({ out: 7, back: 7 });
  });

  it('takes nothing when the return leg is full', async () => {
    const seats = { out: 10, back: 2 };
    expect(await takeSeats(fakeTx(seats), ['out', 'back'], 3)).toBe(false);
    expect(seats).toEqual({ out: 10, back: 2 });
  });

  it('gives seats back on both legs', async () => {
    const seats = { out: 7, back: 7 };
    await releaseBookingSeats(fakeTx(seats), {
      scheduleId: 'out',
      returnScheduleId: 'back',
      adultsCount: 2,
      childrenCount: 1,
    });
    expect(seats).toEqual({ out: 10, back: 10 });
  });

  it('one way gives seats back on the outbound only', async () => {
    const seats = { out: 7, back: 7 };
    await releaseBookingSeats(fakeTx(seats), {
      scheduleId: 'out',
      returnScheduleId: null,
      adultsCount: 3,
      childrenCount: 0,
    });
    expect(seats).toEqual({ out: 10, back: 7 });
  });
});
