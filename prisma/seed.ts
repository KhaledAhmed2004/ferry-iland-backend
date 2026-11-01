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
    { name: 'Malé Ferry Terminal' },
    { name: 'Hulhumalé Port' },
    { name: 'Maafushi Jetty' },
    { name: 'Thulusdhoo Harbour' },
    { name: 'Gulhi Port' },
    { name: 'Dhiffushi Harbour' },
  ];

  const ports = await Promise.all(
    portData.map((p) =>
      prisma.port.upsert({
        where: { name: p.name },
        update: {},
        create: { ...p, isActive: true },
      })
    )
  );
  console.log(`     ✓ ${ports.length} ports seeded`);

  // ── 2. Regular Users ────────────────────────────────────────────────────
  console.log('  → Seeding Regular Users...');

  const userCount = 10;
  const users = await Promise.all(
    Array.from({ length: userCount }, (_, i) =>
      prisma.user.upsert({
        where: { email: `user${pad(i)}@testmail.com` },
        update: {},
        create: {
          email: `user${pad(i)}@testmail.com`,
          passwordHash: PASSWORD_HASH,
          name: `Test User ${pad(i)}`,
          phoneNumber: `+9609900${pad(i)}`,
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
      phoneNumber: '+9601234567',
      role: 'ADMIN',
      status: 'ACTIVE',
      isEmailVerified: true,
      isRootAdmin: true,
    },
  });
  console.log(`     ✓ Admin seeded (${admin.email})`);

  // ── 4. Operators + OperatorProfile ───────────────────────────────────────
  console.log('  → Seeding Operators + Profiles...');

  const operatorCount = 5;
  const operatorCompanies = [
    'Maldives Speed Ferries',
    'Island Express Lines',
    'Atoll Transit Co.',
    'Blue Ocean Ferry',
    'Sunrise Marine Services',
  ];

  const operators = await Promise.all(
    Array.from({ length: operatorCount }, async (_, i) => {
      const opUser = await prisma.user.upsert({
        where: { email: `operator${pad(i)}@elineuque.com` },
        update: {},
        create: {
          email: `operator${pad(i)}@elineuque.com`,
          passwordHash: PASSWORD_HASH,
          name: `Operator ${pad(i)}`,
          phoneNumber: `+9607700${pad(i)}`,
          role: 'OPERATOR',
          status: 'ACTIVE',
          isEmailVerified: true,
        },
      });

      const profile = await prisma.operatorProfile.upsert({
        where: { userId: opUser.id },
        update: {},
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

  // ── 5. Routes (OperatorProfile + Port কে link করে) ──────────────────────
  console.log('  → Seeding Routes...');

  // জনপ্রিয় দ্বীপগুলোর মধ্যে Two-Way Route তৈরি করা হচ্ছে
  const routePairs = [
    // Operator 1: Malé ⇄ Hulhumalé, Malé ⇄ Maafushi
    [0, 1], [1, 0], [0, 2], [2, 0],
    // Operator 2: Malé ⇄ Thulusdhoo, Malé ⇄ Gulhi
    [0, 3], [3, 0], [0, 4], [4, 0],
    // Operator 3: Malé ⇄ Dhiffushi, Maafushi ⇄ Gulhi
    [0, 5], [5, 0], [2, 4], [4, 2],
    // Operator 4: Thulusdhoo ⇄ Dhiffushi, Hulhumalé ⇄ Thulusdhoo
    [3, 5], [5, 3], [1, 3], [3, 1],
  ];

  const routes = await Promise.all(
    routePairs.map(async ([fromIdx, toIdx], i) => {
      const opProfile = operators[i % operatorCount].profile;
      const depPort = ports[fromIdx];
      const destPort = ports[toIdx];

      const existing = await prisma.route.findFirst({
        where: {
          operatorId: opProfile.id,
          departurePortId: depPort.id,
          destinationPortId: destPort.id,
        },
      });

      if (existing) return existing;

      return prisma.route.create({
        data: {
          operatorId: opProfile.id,
          departurePortId: depPort.id,
          destinationPortId: destPort.id,
          durationMinutes: 30 + (i % 4) * 15, // 30–75 মিনিট
          isBorderCrossing: false,
          status: 'ACTIVE',
        },
      });
    })
  );
  console.log(`     ✓ ${routes.length} routes seeded`);

  // ── 6. Ferries (Vessels) ─────────────────────────────────────────────────
  console.log('  → Seeding Ferries (Vessels)...');

  const ferryTemplates = [
    {
      name: 'Ocean Speed 1',
      type: VesselType.SPEEDBOAT,
      capacity: 45,
      imageUrl: 'https://images.unsplash.com/photo-1780553562886-528452a6b697?auto=format&fit=crop&w=800&q=80',
    },
    {
      name: 'Ocean Speed 2',
      type: VesselType.SPEEDBOAT,
      capacity: 40,
      imageUrl: 'https://images.unsplash.com/photo-1545647274-96644da34363?auto=format&fit=crop&w=800&q=80',
    },
    {
      name: 'Island Queen Catamaran',
      type: VesselType.CATAMARAN,
      capacity: 75,
      imageUrl: 'https://images.unsplash.com/photo-1791770963676-bf2f80b1795b?auto=format&fit=crop&w=800&q=80',
    },
    {
      name: 'Island Wave Runner',
      type: VesselType.SPEEDBOAT,
      capacity: 35,
      imageUrl: 'https://images.unsplash.com/photo-1545647274-96644da34363?auto=format&fit=crop&w=800&q=80',
    },
    {
      name: 'Atoll Flyer Alpha',
      type: VesselType.SPEEDBOAT,
      capacity: 50,
      imageUrl: 'https://images.unsplash.com/photo-1787945832826-f299aebdef7e?auto=format&fit=crop&w=800&q=80',
    },
    {
      name: 'Atoll Cruiser Beta',
      type: VesselType.CATAMARAN,
      capacity: 60,
      imageUrl: 'https://images.unsplash.com/photo-1749883530616-b3e0a1c544c5?auto=format&fit=crop&w=800&q=80',
    },
    {
      name: 'Blue Horizon 1',
      type: VesselType.CATAMARAN,
      capacity: 65,
      imageUrl: 'https://images.unsplash.com/photo-1760465789372-965a150847db?auto=format&fit=crop&w=800&q=80',
    },
    {
      name: 'Blue Dart Speedboat',
      type: VesselType.SPEEDBOAT,
      capacity: 30,
      imageUrl: 'https://images.unsplash.com/photo-1605281317010-fe5ffe798166?auto=format&fit=crop&w=800&q=80',
    },
    {
      name: 'Sunrise Pearl Catamaran',
      type: VesselType.CATAMARAN,
      capacity: 80,
      imageUrl: 'https://images.unsplash.com/photo-1781786438702-cdc788dcb5c8?auto=format&fit=crop&w=800&q=80',
    },
    {
      name: 'Sunrise Voyager',
      type: VesselType.SPEEDBOAT,
      capacity: 45,
      imageUrl: 'https://images.unsplash.com/photo-1772109050488-7956bfb2e493?auto=format&fit=crop&w=800&q=80',
    },
  ];

  const ferries = await Promise.all(
    ferryTemplates.map(async (tmpl, idx) => {
      const opProfile = operators[Math.floor(idx / 2) % operatorCount].profile;
      const reg = `MDV-F-${String(idx + 1).padStart(3, '0')}`;
      const vesselImage = tmpl.imageUrl || getDynamicVesselImage(tmpl.type, tmpl.name);
      return prisma.ferry.upsert({
        where: { registration: reg },
        update: {
          name: tmpl.name,
          capacity: tmpl.capacity,
          type: tmpl.type,
          status: VesselStatus.IN_SERVICE,
          imageUrl: vesselImage,
        },
        create: {
          operatorId: opProfile.id,
          name: tmpl.name,
          registration: reg,
          capacity: tmpl.capacity,
          type: tmpl.type,
          status: VesselStatus.IN_SERVICE,
          imageUrl: vesselImage,
        },
      });
    })
  );
  console.log(`     ✓ ${ferries.length} ferries seeded`);

  // ── 7. Schedules (Trips for Next 14 Days) ────────────────────────────────
  console.log('  → Seeding Schedules (Trips for Next 14 Days)...');

  const timeSlots = [
    { hour: 8, minute: 30, gate: 'Pier 1', captain: 'Capt. Ahmed Rasheed' },
    { hour: 11, minute: 0, gate: 'Pier 2', captain: 'Capt. Ibrahim Zaki' },
    { hour: 14, minute: 15, gate: 'Pier 1', captain: 'Capt. Ali Shareef' },
    { hour: 17, minute: 0, gate: 'Pier 3', captain: 'Capt. Mohamed Nazim' },
  ];

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let createdSchedulesCount = 0;

  for (const route of routes) {
    const opFerries = ferries.filter((f) => f.operatorId === route.operatorId);
    if (opFerries.length === 0) continue;

    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const scheduleDate = new Date(today.getTime() + dayOffset * 86400000);
      const isWeekend = scheduleDate.getUTCDay() === 5; // Friday in Maldives
      const slotsForDay = isWeekend ? timeSlots.slice(0, 2) : timeSlots.slice(0, 3);

      for (let sIdx = 0; sIdx < slotsForDay.length; sIdx++) {
        const slot = slotsForDay[sIdx];
        const assignedFerry = opFerries[sIdx % opFerries.length];

        const depTime = new Date(scheduleDate);
        depTime.setUTCHours(slot.hour, slot.minute, 0, 0);

        const arrTime = new Date(depTime.getTime() + route.durationMinutes * 60000);
        const adultFare = route.durationMinutes > 45 ? 35 : 25;
        const childFare = Math.round(adultFare * 0.6);

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
  console.log(`  ${'OPERATOR'.padEnd(10)} ${'operator001@elineuque.com'.padEnd(35)} ACTIVE`);
  console.log('');
  console.log(`  📊  Summary:`);
  console.log(`      Ports:     ${ports.length}`);
  console.log(`      Users:     ${users.length + 1 + operators.length} (${users.length} users + 1 admin + ${operators.length} operators)`);
  console.log(`      Profiles:  ${operators.length}`);
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
