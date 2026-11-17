/**
 * Dev DB trim (2026-11-15, user request): keep only KEEP upcoming schedules
 * (earliest future trip on each of KEEP different routes) and delete the rest.
 * Refuses to delete any schedule referenced by a booking or booking change.
 * Usage: npx tsx scratch/trim-schedules.ts          (dry run)
 *        npx tsx scratch/trim-schedules.ts --apply  (backup to scratch/backups, then delete)
 */
import fs from 'fs';
import path from 'path';
import prisma from '../src/shared/prisma';

const APPLY = process.argv.includes('--apply');
const KEEP = 8;

(async () => {
  const all = await prisma.schedule.findMany({
    orderBy: { departureTime: 'asc' },
    include: { route: { include: { departurePort: true, destinationPort: true } } },
  });
  const now = new Date();
  const keep: typeof all = [];
  const seenRoutes = new Set<string>();
  for (const s of all) {
    if (keep.length >= KEEP) break;
    if (s.departureTime < now || seenRoutes.has(s.routeId)) continue;
    seenRoutes.add(s.routeId);
    keep.push(s);
  }
  const keepIds = new Set(keep.map((s) => s.id));
  const del = all.filter((s) => !keepIds.has(s.id)).map((s) => s.id);

  const refs =
    (await prisma.booking.count({ where: { OR: [{ scheduleId: { in: del } }, { returnScheduleId: { in: del } }] } })) +
    (await prisma.bookingChange.count({ where: { OR: [{ fromScheduleId: { in: del } }, { toScheduleId: { in: del } }] } }));
  if (refs) throw new Error(`${refs} bookings/changes reference schedules to delete; aborting`);

  console.log(`total ${all.length}, keep ${keep.length}, delete ${del.length}`);
  for (const s of keep)
    console.log(`  keep ${s.departureTime.toISOString().slice(0, 16)}  ${s.route.departurePort.name} -> ${s.route.destinationPort.name}`);
  if (!APPLY) return void console.log('dry run; pass --apply');

  const dir = path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `schedules-before-trim-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(all.map(({ route, ...s }) => s), null, 2));
  console.log(`backup: ${file}`);
  const r = await prisma.schedule.deleteMany({ where: { id: { in: del } } });
  console.log(`deleted ${r.count}; remaining ${await prisma.schedule.count()}`);
})()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
