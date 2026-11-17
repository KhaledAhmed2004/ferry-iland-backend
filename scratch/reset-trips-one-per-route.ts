/**
 * Dev DB reset (2026-11-07, user request): delete every trip (with its bookings, tickets,
 * payments, refunds) and create exactly one trip per route on 2026-11-08 (UTC).
 * Usage: npx tsx scratch/reset-trips-one-per-route.ts          (dry run, prints the plan)
 *        npx tsx scratch/reset-trips-one-per-route.ts --apply  (backup, then delete + create)
 */
import fs from 'fs';
import path from 'path';
import prisma from '../src/shared/prisma';

const APPLY = process.argv.includes('--apply');
const DAY = '2026-11-08';
const START_UTC = '05:00';
const TURNAROUND_MIN = 10;
const FERRY_NAME = 'Royal Alpha';

// Port name fragments, in sailing order. Each leg leaves from where the last one arrived
// (Marigot and Philipsburg are on the same island).
const CHAIN: Array<[string, string]> = [
  ['Blowing Point', 'Marigot'], ['Marigot', 'Blowing Point'],
  ['Philipsburg', 'Fort Bay'], ['Fort Bay', 'Gallows Bay'], ['Gallows Bay', 'Port Zante'],
  ['Port Zante', 'Philipsburg'], ['Philipsburg', 'Gallows Bay'], ['Gallows Bay', 'Fort Bay'],
  ['Fort Bay', 'Port Zante'], ['Port Zante', 'Gallows Bay'], ['Gallows Bay', 'Philipsburg'],
  ['Philipsburg', 'Port Zante'], ['Port Zante', 'Fort Bay'], ['Fort Bay', 'Philipsburg'],
];

const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

const mode = <T>(xs: T[]): T | undefined => {
  const m = new Map<string, { v: T; n: number }>();
  for (const x of xs) {
    const k = JSON.stringify(x);
    const e = m.get(k);
    if (e) e.n++;
    else m.set(k, { v: x, n: 1 });
  }
  return [...m.values()].sort((a, b) => b.n - a.n)[0]?.v;
};

const main = async () => {
  const ferry = await prisma.ferry.findFirstOrThrow({ where: { name: FERRY_NAME } });
  if (ferry.status !== 'IN_SERVICE') throw new Error(`${FERRY_NAME} is not IN_SERVICE`);
  const routes = await prisma.route.findMany({
    include: { departurePort: true, destinationPort: true, schedules: true },
  });
  if (routes.length !== CHAIN.length) throw new Error(`expected ${CHAIN.length} routes, found ${routes.length}`);

  const offDays = await prisma.offDay.findMany({
    where: {
      operatorId: ferry.operatorId,
      date: new Date(`${DAY}T00:00:00.000Z`),
      OR: [{ ferryId: ferry.id }, { ferryId: null }],
    },
  });
  if (offDays.length) throw new Error(`off day on ${DAY}: ${offDays.map(o => o.reason).join(', ')}`);

  const used = new Set<string>();
  let cursor: Date | null = null;
  const plan = CHAIN.map(([a, b]) => {
    const r = routes.find(x => x.departurePort.name.includes(a) && x.destinationPort.name.includes(b));
    if (!r) throw new Error(`no route ${a} -> ${b}`);
    if (used.has(r.id)) throw new Error(`route used twice ${a} -> ${b}`);
    used.add(r.id);
    const dep: Date = cursor ?? new Date(`${DAY}T${START_UTC}:00.000Z`);
    const arr = new Date(dep.getTime() + r.durationMinutes * 60_000);
    cursor = new Date(arr.getTime() + TURNAROUND_MIN * 60_000);
    const src = r.schedules;
    const base = r.basePrice ?? 30;
    const fares =
      mode(src.map(s => ({
        adultFare: s.adultFare, childFare: s.childFare,
        adultRoundTripFare: s.adultRoundTripFare, childRoundTripFare: s.childRoundTripFare,
        adultSameDayFare: s.adultSameDayFare, childSameDayFare: s.childSameDayFare,
      }))) ?? {
        adultFare: base, childFare: Math.round(base * 0.6),
        adultRoundTripFare: null, childRoundTripFare: null,
        adultSameDayFare: null, childSameDayFare: null,
      };
    return {
      label: `${r.departurePort.name} -> ${r.destinationPort.name}`,
      when: `${fmt(dep)} -> ${fmt(arr)}`,
      faresFrom: src.length ? `${src.length} existing trips` : 'route base price (no trips)',
      data: {
        routeId: r.id, ferryId: ferry.id, departureTime: dep, arrivalTime: arr,
        gate: mode(src.map(s => s.gate)) ?? 'Pier 1',
        captain: mode(src.map(s => s.captain)) ?? 'Capt. Bryan Richardson',
        availableSeats: ferry.capacity, status: 'ON_TIME' as const, ...fares,
      },
    };
  });

  for (const p of plan) {
    const d = p.data;
    console.log(
      `${p.when.padEnd(44)} ${p.label.padEnd(56)} $${d.adultFare}/$${d.childFare}` +
      `  RT:${d.adultRoundTripFare ?? '-'}  SD:${d.adultSameDayFare ?? '-'}  ${d.gate ?? ''} | ${d.captain ?? ''}  [${p.faresFrom}]`,
    );
  }

  const counts = {
    schedules: await prisma.schedule.count(),
    bookings: await prisma.booking.count(),
    tickets: await prisma.ticket.count(),
    payments: await prisma.payment.count(),
    refunds: await prisma.refund.count(),
    webhookEventsLinked: await prisma.stripeWebhookEvent.count({ where: { paymentId: { not: null } } }),
  };
  console.log('will delete:', counts);
  if (!APPLY) {
    console.log('dry run, nothing changed');
    return;
  }

  const backup = {
    takenAt: new Date().toISOString(),
    schedules: await prisma.schedule.findMany(),
    bookings: await prisma.booking.findMany(),
    tickets: await prisma.ticket.findMany(),
    payments: await prisma.payment.findMany(),
    refunds: await prisma.refund.findMany(),
    stripeWebhookEvents: await prisma.stripeWebhookEvent.findMany({ where: { paymentId: { not: null } } }),
  };
  const file = path.join(__dirname, 'backups', `trips-before-reset-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));
  const sizes = Object.fromEntries(
    Object.entries(backup).filter(([k]) => k !== 'takenAt').map(([k, v]) => [k, (v as unknown[]).length]),
  );
  console.log('backup written:', file, sizes);

  await prisma.$transaction(
    async tx => {
      // Cascades tickets, payments, refunds; webhook events only lose their payment link.
      await tx.booking.deleteMany({});
      await tx.schedule.deleteMany({});
      for (const p of plan) await tx.schedule.create({ data: p.data });
    },
    { timeout: 60_000 },
  );

  const perRoute = await prisma.schedule.groupBy({ by: ['routeId'], _count: true });
  console.log('after:', {
    schedules: await prisma.schedule.count(),
    routesWithExactlyOneTrip: perRoute.filter(g => g._count === 1).length,
    bookings: await prisma.booking.count(),
    tickets: await prisma.ticket.count(),
    payments: await prisma.payment.count(),
  });
};

main()
  .catch(e => {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
