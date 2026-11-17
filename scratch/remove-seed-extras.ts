// Removes every account except the 4 kept ones: Makana operator, user001, two admins.
// Deletes their bookings first (Booking -> Schedule is onDelete: Restrict); the user
// delete cascades to OperatorProfile -> routes -> schedules, ferries, off days, sessions.
// Run: npx tsx scratch/remove-seed-extras.ts
import prisma from '../src/shared/prisma';

const KEEP = [
  'admin@example.com',
  'admin@elineuque.com',
  'user001@testmail.com',
  'khaledahmednayeem.dev@gmail.com',
];

(async () => {
  const r = await prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({ where: { email: { notIn: KEEP } }, select: { id: true, email: true } });
    const ids = users.map((u) => u.id);
    const profiles = await tx.operatorProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    const scheds = await tx.schedule.findMany({
      // Routes are platform-wide now; a schedule belongs to its ferry's operator.
      where: { ferry: { operatorId: { in: profiles.map((p) => p.id) } } },
      select: { id: true },
    });
    const sIds = scheds.map((s) => s.id);
    const bookings = await tx.booking.deleteMany({
      where: { OR: [{ scheduleId: { in: sIds } }, { returnScheduleId: { in: sIds } }, { userId: { in: ids } }] },
    });
    const del = await tx.user.deleteMany({ where: { id: { in: ids } } });
    return { usersDeleted: del.count, emails: users.map((u) => u.email), schedules: sIds.length, bookings: bookings.count };
  });
  console.log(r);
  console.log('operators left:', await prisma.operatorProfile.findMany({
    select: { companyName: true, _count: { select: { ferries: true } } },
  }));
  await prisma.$disconnect();
})();
