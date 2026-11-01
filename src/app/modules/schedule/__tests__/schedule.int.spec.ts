import { AccountStatus, Role, TripStatus } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../../../../app';
import {
  bookingPayload,
  createBookableTrip,
  createUser,
  prisma,
  resetDb,
  tokenFor,
  uniq,
} from '../../../../../test/integration/helpers';

/**
 * Schedules, off-days (blackouts) and the operator-suspend cascade against a real Postgres.
 * Run with `npm run test:int`.
 */
const api = () => request(app);
const DAY = 24 * 60 * 60 * 1000;

/** UTC date `days` from today at hh:mm. */
const at = (days: number, hh: number, mm = 0) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hh, mm, 0, 0);
  return d;
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Operator with an ACTIVE route + IN_SERVICE ferry (capacity 100), plus a signed token. */
async function operatorSetup() {
  const trip = await createBookableTrip();
  const token = await tokenFor(trip.operatorUser);
  return { ...trip, token, auth: `Bearer ${token}` };
}

function schedulePayload(
  o: { route: { id: string }; ferry: { id: string } },
  dep: Date,
  minutes = 60,
  extra: Record<string, unknown> = {},
) {
  return {
    routeId: o.route.id,
    ferryId: o.ferry.id,
    departureTime: dep.toISOString(),
    arrivalTime: new Date(dep.getTime() + minutes * 60_000).toISOString(),
    adultFare: 40,
    childFare: 20,
    ...extra,
  };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/v1/schedules — create', () => {
  it('201: seats default to the ferry capacity, status ON_TIME', async () => {
    const o = await operatorSetup();

    const res = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 8)));

    expect(res.status).toBe(201);
    expect(res.body.data.availableSeats).toBe(o.ferry.capacity);
    expect(res.body.data.status).toBe(TripStatus.ON_TIME);
  });

  it('400: arrival before departure', async () => {
    const o = await operatorSetup();
    const dep = at(10, 8);
    const body = { ...schedulePayload(o, dep), arrivalTime: new Date(dep.getTime() - 60_000).toISOString() };

    const res = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(body);

    expect(res.status).toBe(400);
    expect(res.body.errorMessages.map((e: { path: string }) => e.path)).toContain('arrivalTime');
  });

  it("404: cannot schedule another operator's ferry or route", async () => {
    const mine = await operatorSetup();
    const theirs = await createBookableTrip();

    const otherFerry = await api()
      .post('/api/v1/schedules')
      .set('Authorization', mine.auth)
      .send(schedulePayload({ route: mine.route, ferry: theirs.ferry }, at(10, 8)));
    const otherRoute = await api()
      .post('/api/v1/schedules')
      .set('Authorization', mine.auth)
      .send(schedulePayload({ route: theirs.route, ferry: mine.ferry }, at(10, 8)));

    expect(otherFerry.status).toBe(404);
    expect(otherRoute.status).toBe(404);
  });

  it('400: inactive route or ferry not IN_SERVICE', async () => {
    const o = await operatorSetup();
    await prisma.route.update({ where: { id: o.route.id }, data: { status: 'INACTIVE' } });
    const inactiveRoute = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 8)));

    await prisma.route.update({ where: { id: o.route.id }, data: { status: 'ACTIVE' } });
    await prisma.ferry.update({ where: { id: o.ferry.id }, data: { status: 'MAINTENANCE' } });
    const ferryDown = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 8)));

    expect(inactiveRoute.status).toBe(400);
    expect(ferryDown.status).toBe(400);
  });

  it('403: a customer cannot create schedules', async () => {
    const o = await operatorSetup();
    const customer = await createUser(Role.USER);

    const res = await api()
      .post('/api/v1/schedules')
      .set('Authorization', `Bearer ${await tokenFor(customer)}`)
      .send(schedulePayload(o, at(10, 8)));

    expect(res.status).toBe(403);
  });

  it('400: seats above the ferry capacity are rejected', async () => {
    const o = await operatorSetup(); // capacity 100

    const res = await api()
      .post('/api/v1/schedules')
      .set('Authorization', o.auth)
      .send(schedulePayload(o, at(10, 8), 60, { availableSeats: o.ferry.capacity + 50 }));

    expect(res.status, 'a 100-seat ferry should not sell 150 seats').toBe(400);
  });
});

describe('Vessel clash — one ferry, one voyage at a time', () => {
  it('400: overlapping time window on the same ferry', async () => {
    const o = await operatorSetup();
    await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 8), 60)).expect(201);

    const res = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 8, 30), 60));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/conflict/i);
  });

  it('201: back-to-back trips (arrival == next departure) are allowed', async () => {
    const o = await operatorSetup();
    await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 8), 60)).expect(201);

    const res = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 9), 60));

    expect(res.status).toBe(201);
  });

  it('201: a cancelled trip frees its slot', async () => {
    const o = await operatorSetup();
    const first = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 8)));
    await api()
      .patch(`/api/v1/schedules/${first.body.data.id}/status`)
      .set('Authorization', o.auth)
      .send({ status: TripStatus.CANCELLED })
      .expect(200);

    const res = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 8)));

    expect(res.status).toBe(201);
  });

  it('400: moving a trip (PATCH) onto another trip of the same ferry', async () => {
    const o = await operatorSetup();
    await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 8))).expect(201);
    const later = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 14)));

    const res = await api()
      .patch(`/api/v1/schedules/${later.body.data.id}`)
      .set('Authorization', o.auth)
      .send({ departureTime: at(10, 8, 15).toISOString(), arrivalTime: at(10, 9, 15).toISOString() });

    expect(res.status).toBe(400);
  });

  it('two simultaneous creates for the same slot: only one is saved', async () => {
    const o = await operatorSetup();
    const body = schedulePayload(o, at(10, 8));

    const results = await Promise.all(
      [1, 2].map(() => api().post('/api/v1/schedules').set('Authorization', o.auth).send(body)),
    );

    const saved = await prisma.schedule.count({ where: { ferryId: o.ferry.id, departureTime: new Date(body.departureTime) } });
    expect(saved, 'the same ferry must not be double-booked for one time slot').toBe(1);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
  });
});

describe('Off-days (blackouts) block scheduling', () => {
  it('400: fleet-wide off-day blocks every ferry that UTC day', async () => {
    const o = await operatorSetup();
    const day = at(12, 0);
    await api()
      .post('/api/v1/off-days')
      .set('Authorization', o.auth)
      .send({ date: ymd(day), reason: 'Public holiday', category: 'PUBLIC_HOLIDAY' })
      .expect(201);

    const morning = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(12, 0, 30)));
    const lateNight = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(12, 23, 0), 30));
    const nextDay = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(13, 0, 30)));

    expect(morning.status).toBe(400);
    expect(morning.body.message).toMatch(/blackout/i);
    expect(lateNight.status).toBe(400);
    expect(nextDay.status).toBe(201);
  });

  it('ferry-specific off-day blocks only that ferry', async () => {
    const o = await operatorSetup();
    const otherFerry = await prisma.ferry.create({
      data: { operatorId: o.operator.id, name: `Spare ${uniq()}`, registration: `REG-${uniq()}`, capacity: 50 },
    });
    await api()
      .post('/api/v1/off-days')
      .set('Authorization', o.auth)
      .send({ date: ymd(at(12, 0)), reason: 'Engine service', ferryId: o.ferry.id })
      .expect(201);

    const blocked = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(12, 8)));
    const other = await api()
      .post('/api/v1/schedules')
      .set('Authorization', o.auth)
      .send(schedulePayload({ route: o.route, ferry: otherFerry }, at(12, 8)));

    expect(blocked.status).toBe(400);
    expect(other.status).toBe(201);
  });

  it('409: same off-day twice for the same ferry and date', async () => {
    const o = await operatorSetup();
    const body = { date: ymd(at(12, 0)), reason: 'Dry dock', ferryId: o.ferry.id };
    await api().post('/api/v1/off-days').set('Authorization', o.auth).send(body).expect(201);

    const res = await api().post('/api/v1/off-days').set('Authorization', o.auth).send(body);

    expect(res.status).toBe(409);
  });

  it("404: cannot add an off-day for another operator's ferry, or read theirs", async () => {
    const mine = await operatorSetup();
    const theirs = await operatorSetup();
    const theirOffDay = await api()
      .post('/api/v1/off-days')
      .set('Authorization', theirs.auth)
      .send({ date: ymd(at(12, 0)), reason: 'Their holiday' })
      .expect(201);

    const create = await api()
      .post('/api/v1/off-days')
      .set('Authorization', mine.auth)
      .send({ date: ymd(at(12, 0)), reason: 'Not my ferry', ferryId: theirs.ferry.id });
    const read = await api().get(`/api/v1/off-days/${theirOffDay.body.data.id}`).set('Authorization', mine.auth);

    expect(create.status).toBe(404);
    expect(read.status).toBe(404);
  });

  it('400: moving a trip (PATCH) onto a blackout date is rejected', async () => {
    const o = await operatorSetup();
    const trip = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 8)));
    await api()
      .post('/api/v1/off-days')
      .set('Authorization', o.auth)
      .send({ date: ymd(at(12, 0)), reason: 'Storm warning', category: 'WEATHER' })
      .expect(201);

    const res = await api()
      .patch(`/api/v1/schedules/${trip.body.data.id}`)
      .set('Authorization', o.auth)
      .send({ departureTime: at(12, 8).toISOString(), arrivalTime: at(12, 9).toISOString() });

    expect(res.status, 'PATCH should apply the same blackout rule as POST').toBe(400);
  });
});

describe('Delete schedule', () => {
  it('400: a schedule with bookings cannot be deleted; an empty one can', async () => {
    const o = await operatorSetup();
    await api().post('/api/v1/bookings').send(bookingPayload(o.schedule.id)).expect(201);
    const empty = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 8)));

    const booked = await api().delete(`/api/v1/schedules/${o.schedule.id}`).set('Authorization', o.auth);
    const unbooked = await api().delete(`/api/v1/schedules/${empty.body.data.id}`).set('Authorization', o.auth);

    expect(booked.status).toBe(400);
    expect(await prisma.schedule.count({ where: { id: o.schedule.id } })).toBe(1);
    expect(unbooked.status).toBe(200);
    expect(await prisma.schedule.count({ where: { id: empty.body.data.id } })).toBe(0);
  });
});

describe('Admin suspends an operator — schedule cascade', () => {
  it('cancels unbooked future trips, keeps booked ones, hides the operator from search', async () => {
    const o = await operatorSetup(); // o.schedule is 3 days out
    const admin = await createUser(Role.ADMIN);
    await api().post('/api/v1/bookings').send(bookingPayload(o.schedule.id)).expect(201);
    const unbooked = await prisma.schedule.create({
      data: {
        routeId: o.route.id,
        ferryId: o.ferry.id,
        departureTime: at(5, 8),
        arrivalTime: at(5, 9),
        adultFare: 40,
        availableSeats: 10,
      },
    });

    const res = await api()
      .patch(`/api/v1/admin/providers/${o.operator.id}/status`)
      .set('Authorization', `Bearer ${await tokenFor(admin)}`)
      .send({ status: AccountStatus.SUSPENDED });
    expect(res.status).toBe(200);

    const [bookedAfter, unbookedAfter] = await Promise.all([
      prisma.schedule.findUniqueOrThrow({ where: { id: o.schedule.id } }),
      prisma.schedule.findUniqueOrThrow({ where: { id: unbooked.id } }),
    ]);
    expect(unbookedAfter.status).toBe(TripStatus.CANCELLED);
    expect(bookedAfter.status, 'trip with passengers is not silently cancelled').toBe(TripStatus.ON_TIME);

    const ports = await prisma.route.findUniqueOrThrow({
      where: { id: o.route.id },
      include: { departurePort: true, destinationPort: true },
    });
    const search = await api()
      .get('/api/v1/trips/search')
      .query({ from: ports.departurePort.name, to: ports.destinationPort.name, departureDate: ymd(o.schedule.departureTime) });
    expect(search.status).toBe(200);
    expect(search.body.data.outboundTrips).toEqual([]);

    const blocked = await api().post('/api/v1/schedules').set('Authorization', o.auth).send(schedulePayload(o, at(10, 8)));
    expect(blocked.status, 'suspended operator token is rejected').toBeGreaterThanOrEqual(401);
  });
});
