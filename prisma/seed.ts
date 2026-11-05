/**
 * Prisma Database Seeder
 *
 * Uses @snaplet/seed to auto-read schema.prisma and generate
 * type-safe, FK-aware seed data for PostgreSQL.
 *
 * Seeding Order (FK dependency):
 *   1. Port            — no dependencies
 *   2. User (USER)     — no dependencies
 *   3. User (ADMIN)    — no dependencies
 *   4. User (OPERATOR) — no dependencies
 *   5. OperatorProfile — depends on User
 *   6. Session         — depends on User
 *   7. Route           — depends on OperatorProfile + Port
 *
 * CLI Usage (via package.json):
 *   npm run seed         — seed all data (upsert-safe)
 *   npm run seed:fresh   — reset DB + migrate + re-seed
 *
 * Credentials after seeding:
 *   Admin:    admin@elineuque.com      / Password123!
 *   User:     user1@testmail.com       / Password123!
 *   Operator: operator1@elineuque.com  / Password123!
 */

import { PrismaClient, VesselType, VesselStatus, TripStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { getDynamicVesselImage } from '../src/shared/mediaCatalog';
import { portToday, wallTimeToInstant } from '../src/shared/portTime';

/** `YYYY-MM-DD` plus `days` calendar days (UTC arithmetic on a date only, no zone involved). */
const addCalendarDays = (ymd: string, days: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// ─── Production Guard ────────────────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  console.error('\n⛔  SEEDER BLOCKED: Cannot run seeder in NODE_ENV=production.');
  console.error('    If you are absolutely sure, unset NODE_ENV temporarily.\n');
  process.exit(1);
}

// ─── Prisma Client ───────────────────────────────────────────────────────────

const prisma = new PrismaClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────

const pad = (n: number, width = 3) => String(n + 1).padStart(width, '0');

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌱  Starting PostgreSQL Seeder...\n');

  const PASSWORD_HASH = await bcrypt.hash('Password123!', 10);

  // ── 1. Ports ─────────────────────────────────────────────────────────────
  console.log('  → Seeding Ports...');

  const portData = [
    // Each port's IANA zone: trip times are shown and read in it (spec 0003).
    { name: 'Blowing Point, Anguilla', timeZone: 'America/Anguilla' },
    { name: 'Marigot, Saint Martin', timeZone: 'America/Marigot' },
    { name: 'Philipsburg, Sint Maarten', timeZone: 'America/Lower_Princes' },
    { name: 'Fort Bay Harbor, Saba', timeZone: 'America/Kralendijk' },
    { name: 'Gallows Bay, Sint Eustatius', timeZone: 'America/Kralendijk' },
    { name: 'Port Zante, St. Kitts', timeZone: 'America/St_Kitts' },
  ];

  // Clean up any legacy ports not in the allowed port list
  const portNames = portData.map((p) => p.name);
  const legacyPorts = await prisma.port.findMany({
    where: { name: { notIn: portNames } },
    select: { id: true },
  });
  if (legacyPorts.length > 0) {
    const legacyPortIds = legacyPorts.map((p) => p.id);
    const legacyRoutes = await prisma.route.findMany({
      where: {
        OR: [
          { departurePortId: { in: legacyPortIds } },
          { destinationPortId: { in: legacyPortIds } },
        ],
      },
      select: { id: true },
    });
    const legacyRouteIds = legacyRoutes.map((r) => r.id);
    const legacySchedules = await prisma.schedule.findMany({
      where: { routeId: { in: legacyRouteIds } },
      select: { id: true },
    });
    const legacyScheduleIds = legacySchedules.map((s) => s.id);
    await prisma.booking.deleteMany({ where: { scheduleId: { in: legacyScheduleIds } } });
    await prisma.schedule.deleteMany({ where: { id: { in: legacyScheduleIds } } });
    await prisma.route.deleteMany({ where: { id: { in: legacyRouteIds } } });
    await prisma.port.deleteMany({ where: { id: { in: legacyPortIds } } });
  }

  const ports = await Promise.all(
    portData.map((p) =>
      prisma.port.upsert({
        where: { name: p.name },
        update: { isActive: true, timeZone: p.timeZone },
        create: { ...p, isActive: true },
      })
    )
  );
  console.log(`     ✓ ${ports.length} ports seeded`);

  // ── 2. Regular Users ────────────────────────────────────────────────────
  console.log('  → Seeding Regular Users...');

  // Only user001 — the dev DB is kept to one customer account (user002–010 were removed on purpose).
  const userCount = 1;
  const users = await Promise.all(
    Array.from({ length: userCount }, (_, i) =>
      prisma.user.upsert({
        where: { email: `user${pad(i)}@testmail.com` },
        update: {},
        create: {
          email: `user${pad(i)}@testmail.com`,
          passwordHash: PASSWORD_HASH,
          name: `Test User ${pad(i)}`,
          phoneNumber: `+12649900${pad(i)}`,
          role: 'USER',
          status: 'ACTIVE',
          isEmailVerified: true,
        },
      })
    )
  );
  console.log(`     ✓ ${users.length} users seeded`);

  // ── 3. Admin User ────────────────────────────────────────────────────────
  console.log('  → Seeding Admin...');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@elineuque.com' },
    update: {},
    create: {
      email: 'admin@elineuque.com',
      passwordHash: PASSWORD_HASH,
      name: 'Super Admin',
      phoneNumber: '+17215234567',
      role: 'ADMIN',
      status: 'ACTIVE',
      isEmailVerified: true,
      isRootAdmin: true,
    },
  });
  console.log(`     ✓ Admin seeded (${admin.email})`);

  // ── 4. Operators + OperatorProfile ───────────────────────────────────────
  console.log('  → Seeding Operators + Profiles...');

  // The only operator is Makana Ferry Service. Its real account owns everything;
  // operator001 is created only on a fresh DB where that account does not exist.
  // (The other demo operators 002–005 were removed on purpose — do not re-add them.)
  const MAKANA_OWNER_EMAIL = 'khaledahmednayeem.dev@gmail.com';
  const realMakanaProfile = await prisma.operatorProfile.findFirst({
    where: { user: { email: MAKANA_OWNER_EMAIL } },
  });
  const operatorCount = realMakanaProfile ? 0 : 1;
  const operatorCompanies = ['Makana Ferry Service'];

  const operators = await Promise.all(
    Array.from({ length: operatorCount }, async (_, i) => {
      const opUser = await prisma.user.upsert({
        where: { email: `operator${pad(i)}@elineuque.com` },
        update: {},
        create: {
          email: `operator${pad(i)}@elineuque.com`,
          passwordHash: PASSWORD_HASH,
          name: `Operator ${pad(i)}`,
          phoneNumber: `+17217700${pad(i)}`,
          role: 'OPERATOR',
          status: 'ACTIVE',
          isEmailVerified: true,
        },
      });

      const profile = await prisma.operatorProfile.upsert({
        where: { userId: opUser.id },
        update: {
          companyName: operatorCompanies[i] ?? `Ferry Co. ${pad(i)}`,
        },
        create: {
          userId: opUser.id,
          companyName: operatorCompanies[i] ?? `Ferry Co. ${pad(i)}`,
          contactPersonName: `Contact ${pad(i)}`,
        },
      });

      return { user: opUser, profile };
    })
  );
  console.log(`     ✓ ${operators.length} operators + profiles seeded`);

  // ── 4b. Makana Ferry Service owner ───────────────────────────────────────
  // The real Makana operator account owns the Makana fleet/routes. Falls back
  // to the seeded operator001 when that account does not exist (fresh DB).
  const makanaProfile = realMakanaProfile ?? operators[0].profile;
  if (realMakanaProfile) {
    // Company info from Makana's settings sheet (Anguilla office).
    await prisma.operatorProfile.update({
      where: { id: realMakanaProfile.id },
      data: {
        companyName: 'Makana Ferry Service (Blues & Blues Ltd.)',
        contactPersonName: 'Makana Ferry Service',
        contactEmail: 'info@makanaferryservice.com',
        businessAddress: 'Blowing Point, Anguilla',
      },
    });
    await prisma.user.update({
      where: { id: realMakanaProfile.userId },
      data: { name: 'Makana Ferry Service', phoneNumber: '+12644976164' },
    });
  }
  const legacyOperator001 = realMakanaProfile
    ? await prisma.operatorProfile.findFirst({ where: { user: { email: 'operator001@elineuque.com' } } })
    : null;
  if (realMakanaProfile && legacyOperator001) {
    // Hand over anything left on an old operator001 account (routes carry their schedules).
    const fromId = legacyOperator001.id;
    const movedRoutes = await prisma.route.updateMany({ where: { operatorId: fromId }, data: { operatorId: makanaProfile.id } });
    const movedFerries = await prisma.ferry.updateMany({ where: { operatorId: fromId }, data: { operatorId: makanaProfile.id } });
    await prisma.offDay.updateMany({ where: { operatorId: fromId }, data: { operatorId: makanaProfile.id } });
    console.log(`     ✓ Makana owner = ${MAKANA_OWNER_EMAIL} (moved ${movedRoutes.count} routes, ${movedFerries.count} ferries from operator001)`);
  }
  // Every route and ferry belongs to Makana (the only operator).
  const operatorProfileAt = (_idx: number) => makanaProfile;

  // ── 5. Routes (OperatorProfile + Port কে link করে) ──────────────────────
  console.log('  → Seeding Routes...');

  // 0: Blowing Point, Anguilla
  // 1: Marigot, Saint Martin
  // 2: Philipsburg, Sint Maarten
  // 3: Fort Bay Harbor, Saba
  // 4: Gallows Bay, Sint Eustatius
  // 5: Port Zante, St. Kitts
  const routePairs = [
    // Anguilla ⇄ Saint Martin
    [0, 1], [1, 0],
    // Sint Maarten ⇄ Saba
    [2, 3], [3, 2],
    // Sint Maarten ⇄ Sint Eustatius
    [2, 4], [4, 2],
    // Sint Maarten ⇄ St. Kitts
    [2, 5], [5, 2],
    // Saba ⇄ Sint Eustatius
    [3, 4], [4, 3],
    // Saba ⇄ St. Kitts
    [3, 5], [5, 3],
    // Sint Eustatius ⇄ St. Kitts
    [4, 5], [5, 4],
  ];

  const routePairDetails: Record<string, { durationMinutes: number; adultFare: number }> = {
    '0-1': { durationMinutes: 25, adultFare: 30 },
    '1-0': { durationMinutes: 25, adultFare: 30 },
    '2-3': { durationMinutes: 90, adultFare: 65 },
    '3-2': { durationMinutes: 90, adultFare: 65 },
    '2-4': { durationMinutes: 90, adultFare: 65 },
    '4-2': { durationMinutes: 90, adultFare: 65 },
    '2-5': { durationMinutes: 120, adultFare: 85 },
    '5-2': { durationMinutes: 120, adultFare: 85 },
    '3-4': { durationMinutes: 45, adultFare: 40 },
    '4-3': { durationMinutes: 45, adultFare: 40 },
    '3-5': { durationMinutes: 75, adultFare: 55 },
    '5-3': { durationMinutes: 75, adultFare: 55 },
    '4-5': { durationMinutes: 45, adultFare: 40 },
    '5-4': { durationMinutes: 45, adultFare: 40 },
  };

  // Client fare matrix (2026-11-05), per passenger, From -> To.
  // [adultRoundTrip, adultOneWay, adultSameDay, childRoundTrip, childOneWay, childSameDay]; null = not offered (✕).
  // 2: Sint Maarten, 3: Saba, 4: Statia (Sint Eustatius), 5: St. Kitts
  type FareRow = [number, number, number | null, number, number, number | null];
  const clientFareMatrix: Record<string, FareRow> = {
    '4-3': [103, 56.5, null, 78, 41.5, null],
    '4-2': [140, 95, null, 110, 65, null],
    '4-5': [108, 61.5, 99, 83, 46.5, 77],
    '3-4': [103, 61.5, 94, 78, 46.5, 72],
    '3-2': [134, 94.5, null, 104, 64.5, null],
    '3-5': [126, 88, 107.25, 96, 58, 77.25],
    '2-4': [140, 90, 121.25, 110, 60, 91.25],
    '2-3': [134, 84.5, 115.25, 104, 54.5, 85.25],
    '2-5': [253, 159, 191.38, 203, 124, 154.13],
    '5-4': [108, 61.5, 99, 83, 46.5, 77],
    '5-3': [126, 83, null, 96, 53, null],
    '5-2': [253, 159, null, 203, 124, null],
  };
  const bundleFaresFor = (key: string) => {
    const row = clientFareMatrix[key];
    return {
      adultRoundTripFare: row ? row[0] : null,
      childRoundTripFare: row ? row[3] : null,
      adultSameDayFare: row ? row[2] : null,
      childSameDayFare: row ? row[5] : null,
    };
  };
  const routeKeyById = new Map<string, string>();
  /** One way fares for a seeded schedule: the client matrix when the route has one. */
  const oneWayFaresFor = (routeId: string) => {
    const row = clientFareMatrix[routeKeyById.get(routeId) ?? ''];
    return row ? { adultFare: row[1], childFare: row[4] } : null;
  };

  const routes = await Promise.all(
    routePairs.map(async ([fromIdx, toIdx], i) => {
      const routeKey = `${fromIdx}-${toIdx}`;
      // The client (Makana) runs every route in its fare matrix, both directions, so a
      // round trip or same day return always has a return ferry from the same operator.
      const isClientRoute = routeKey in clientFareMatrix;
      const opProfile = isClientRoute ? makanaProfile : operatorProfileAt(i);
      const depPort = ports[fromIdx];
      const destPort = ports[toIdx];
      const details = routePairDetails[routeKey] ?? { durationMinutes: 45, adultFare: 35 };
      const bundleFares = bundleFaresFor(routeKey);

      // A client route seeded earlier under another operator is handed over to Makana.
      const existing =
        (await prisma.route.findFirst({
          where: {
            operatorId: opProfile.id,
            departurePortId: depPort.id,
            destinationPortId: destPort.id,
          },
        })) ??
        (isClientRoute
          ? await prisma.route.findFirst({
              where: { departurePortId: depPort.id, destinationPortId: destPort.id },
            })
          : null);

      const route = existing
        ? await prisma.route.update({
            where: { id: existing.id },
            data: {
              operatorId: opProfile.id,
              durationMinutes: details.durationMinutes,
              status: 'ACTIVE',
              ...bundleFares,
            },
          })
        : await prisma.route.create({
            data: {
              operatorId: opProfile.id,
              departurePortId: depPort.id,
              destinationPortId: destPort.id,
              durationMinutes: details.durationMinutes,
              isBorderCrossing: true,
              status: 'ACTIVE',
              ...bundleFares,
            },
          });
      routeKeyById.set(route.id, routeKey);
      return route;
    })
  );
  console.log(`     ✓ ${routes.length} routes seeded`);

  // ── 6. Ferries (Vessels) ─────────────────────────────────────────────────
  console.log('  → Seeding Ferries (Vessels)...');

  type FerryTemplate = {
    operatorIdx: number;
    name: string;
    type: VesselType;
    capacity: number;
    status?: VesselStatus;
    imageUrl?: string;
  };

  // Makana Ferry Service (operator001) — real fleet sheet.
  // Ferry type blank → schema default (CATAMARAN). "Docked" → OUT_OF_SERVICE.
  // Cruising speed is not stored in the schema.
  const MAKANA_MAINTENANCE_UNTIL = new Date(Date.UTC(2026, 10, 19)); // Nov 19, 2026
  const makanaFerryTemplates: FerryTemplate[] = [
    {
      operatorIdx: 0,
      name: 'M/V Makana',
      type: VesselType.CATAMARAN, // Sabra Catamaran Fast Ferry
      capacity: 150,
      status: VesselStatus.MAINTENANCE,
      imageUrl: 'https://images.unsplash.com/photo-1791770963676-bf2f80b1795b?auto=format&fit=crop&w=800&q=80',
    },
    {
      operatorIdx: 0,
      name: 'Samantha II',
      type: VesselType.CATAMARAN,
      capacity: 100,
      status: VesselStatus.OUT_OF_SERVICE,
      imageUrl: 'https://images.unsplash.com/photo-1749883530616-b3e0a1c544c5?auto=format&fit=crop&w=800&q=80',
    },
    {
      operatorIdx: 0,
      name: 'Royal Alpha',
      type: VesselType.CATAMARAN,
      capacity: 112,
      status: VesselStatus.IN_SERVICE,
      imageUrl: 'https://images.unsplash.com/photo-1781786438702-cdc788dcb5c8?auto=format&fit=crop&w=800&q=80',
    },
  ];

  // Only these 3 vessels exist in the DB — every other ferry is removed below.
  const ferryTemplates: FerryTemplate[] = makanaFerryTemplates;

  const ferries = await Promise.all(
    ferryTemplates.map(async (tmpl) => {
      const opProfile = operatorProfileAt(tmpl.operatorIdx);
      const status = tmpl.status ?? VesselStatus.IN_SERVICE;
      const vesselImage = tmpl.imageUrl || getDynamicVesselImage(tmpl.type, tmpl.name);
      const data = {
        operatorId: opProfile.id,
        name: tmpl.name,
        capacity: tmpl.capacity,
        type: tmpl.type,
        status,
        imageUrl: vesselImage,
      };
      // Ferries have no unique natural key → match on (operator, name).
      const existing = await prisma.ferry.findFirst({
        where: { operatorId: opProfile.id, name: tmpl.name },
        select: { id: true },
      });
      return existing
        ? prisma.ferry.update({ where: { id: existing.id }, data })
        : prisma.ferry.create({ data });
    })
  );
  console.log(`     ✓ ${ferries.length} ferries seeded`);

  // ── 6b. Remove EVERY ferry not in the template list ──────────────────────
  // Deletes their schedules and those schedules' bookings (tickets/payments
  // cascade) since Schedule→Ferry and Booking→Schedule are onDelete: Restrict.
  const makanaFerries = ferries.filter((f) => f.operatorId === makanaProfile.id);
  const staleFerries = await prisma.ferry.findMany({
    where: { id: { notIn: ferries.map((f) => f.id) } },
    select: { id: true, name: true },
  });
  if (staleFerries.length > 0) {
    const staleFerryIds = staleFerries.map((f) => f.id);
    const removed = await prisma.$transaction(async (tx) => {
      const scheds = await tx.schedule.findMany({
        where: { ferryId: { in: staleFerryIds } },
        select: { id: true },
      });
      const schedIds = scheds.map((s) => s.id);
      const bookings = await tx.booking.deleteMany({ where: { scheduleId: { in: schedIds } } });
      await tx.schedule.deleteMany({ where: { id: { in: schedIds } } });
      await tx.ferry.deleteMany({ where: { id: { in: staleFerryIds } } });
      return { schedules: schedIds.length, bookings: bookings.count };
    });
    console.log(
      `     ✓ removed ${staleFerries.length} other ferries + ${removed.schedules} schedules + ${removed.bookings} bookings: ${staleFerries.map((f) => f.name).join(', ')}`,
    );
  }

  // Booking-free schedules on non-IN_SERVICE Makana vessels are cleared too.
  for (const f of makanaFerries.filter((f) => f.status !== VesselStatus.IN_SERVICE)) {
    await prisma.schedule.deleteMany({ where: { ferryId: f.id, bookings: { none: {} } } });
  }

  // ── 6c. M/V Makana maintenance blackout (today → Nov 19) ─────────────────
  const mvMakana = makanaFerries.find((f) => f.name === 'M/V Makana')!;
  // Port zone of every port, so trips and off days follow local days (spec 0003).
  const portZoneById = new Map(
    (await prisma.port.findMany({ select: { id: true, timeZone: true } })).map((p) => [p.id, p.timeZone]),
  );
  // Off days are calendar dates at the operator's ports; start from today there.
  const makanaRoute = routes.find((r) => r.operatorId === makanaProfile.id);
  const makanaZone = (makanaRoute && portZoneById.get(makanaRoute.departurePortId)) || 'America/Kralendijk';
  const makanaToday = portToday(makanaZone);
  const maintenanceUntil = MAKANA_MAINTENANCE_UNTIL.toISOString().slice(0, 10);
  let maintenanceDays = 0;
  for (let ymd = makanaToday; ymd <= maintenanceUntil; ymd = addCalendarDays(ymd, 1)) {
    const date = new Date(`${ymd}T00:00:00.000Z`);
    const exists = await prisma.offDay.findFirst({
      where: { operatorId: makanaProfile.id, ferryId: mvMakana.id, date },
    });
    if (!exists) {
      await prisma.offDay.create({
        data: {
          operatorId: makanaProfile.id,
          ferryId: mvMakana.id,
          date,
          reason: 'Scheduled maintenance (until Nov 19)',
          category: 'MAINTENANCE',
        },
      });
      maintenanceDays++;
    }
  }
  console.log(`     ✓ ${maintenanceDays} maintenance off-day(s) added for M/V Makana`);

  // ── 7. Schedules (Trips for Next 14 Days) ────────────────────────────────
  console.log('  → Seeding Schedules (Trips for Next 14 Days)...');

  const timeSlots = [
    { hour: 8, minute: 30, gate: 'Pier 1', captain: 'Capt. Bryan Richardson' },
    { hour: 11, minute: 0, gate: 'Pier 2', captain: 'Capt. Carlos Hodge' },
    { hour: 14, minute: 15, gate: 'Pier 1', captain: 'Capt. Marcus Peterson' },
    { hour: 17, minute: 0, gate: 'Pier 3', captain: 'Capt. David Connor' },
  ];

  let createdSchedulesCount = 0;

  for (const route of routes) {
    const opFerries = ferries.filter(
      (f) => f.operatorId === route.operatorId && f.status === VesselStatus.IN_SERVICE,
    );
    if (opFerries.length === 0) continue;

    // Sailing times are wall clock times at the departure port (spec 0003, AC-12).
    const zone = portZoneById.get(route.departurePortId)!;
    const portTodayYmd = portToday(zone);

    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const scheduleYmd = addCalendarDays(portTodayYmd, dayOffset);
      const isWeekend = new Date(`${scheduleYmd}T12:00:00Z`).getUTCDay() === 0; // Sunday at the port
      const slotsForDay = isWeekend ? timeSlots.slice(0, 2) : timeSlots.slice(0, 3);

      for (let sIdx = 0; sIdx < slotsForDay.length; sIdx++) {
        const slot = slotsForDay[sIdx];
        const assignedFerry = opFerries[sIdx % opFerries.length];

        const pad = (n: number) => String(n).padStart(2, '0');
        const depTime = wallTimeToInstant(`${scheduleYmd}T${pad(slot.hour)}:${pad(slot.minute)}`, zone);

        const arrTime = new Date(depTime.getTime() + route.durationMinutes * 60000);
        const durationFare =
          route.durationMinutes >= 90
            ? 75
            : route.durationMinutes >= 60
            ? 55
            : route.durationMinutes >= 40
            ? 40
            : 30;
        const { adultFare, childFare } = oneWayFaresFor(route.id) ?? {
          adultFare: durationFare,
          childFare: Math.round(durationFare * 0.6),
        };

        const existingSched = await prisma.schedule.findFirst({
          where: {
            routeId: route.id,
            departureTime: depTime,
          },
        });

        if (!existingSched) {
          await prisma.schedule.create({
            data: {
              routeId: route.id,
              ferryId: assignedFerry.id,
              departureTime: depTime,
              arrivalTime: arrTime,
              adultFare,
              childFare,
              availableSeats: assignedFerry.capacity,
              status: TripStatus.ON_TIME,
              gate: slot.gate,
              captain: slot.captain,
            },
          });
          createdSchedulesCount++;
        }
      }
    }
  }
  console.log(`     ✓ ${createdSchedulesCount} new schedules created across next 14 days`);

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅  Seeding Complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  📋  Test Credentials (password: Password123!)');
  console.log('');
  console.log(`  ${'Role'.padEnd(10)} ${'Email'.padEnd(35)} Status`);
  console.log(`  ${'────'.padEnd(10)} ${'─────'.padEnd(35)} ──────`);
  console.log(`  ${'ADMIN'.padEnd(10)} ${'admin@elineuque.com'.padEnd(35)} ACTIVE`);
  console.log(`  ${'USER'.padEnd(10)} ${'user001@testmail.com'.padEnd(35)} ACTIVE`);
  console.log(`  ${'OPERATOR'.padEnd(10)} ${(realMakanaProfile ? MAKANA_OWNER_EMAIL : 'operator001@elineuque.com').padEnd(35)} ACTIVE`);
  console.log('');
  console.log(`  📊  Summary:`);
  console.log(`      Ports:     ${ports.length}`);
  console.log(`      Users:     ${users.length} user(s) + 1 admin + 1 operator (Makana)`);
  console.log(`      Routes:    ${routes.length}`);
  console.log(`      Ferries:   ${ferries.length}`);
  console.log(`      Schedules: ${createdSchedulesCount}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch((e) => {
    console.error('\n  ✗  Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
