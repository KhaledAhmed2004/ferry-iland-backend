// Moves the client's Makana Ferry Service data (ferries, routes with their
// schedules, off days) from the seed account operator001 to the Makana
// operator account khaledahmednayeem.dev@gmail.com, and fills that account's
// company details from the client's sheet (WEBSITE and APP updates_2026-11.pdf).
// Writes a backup of what it changes to scratch/makana-move-backup.json first.
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();
const FROM_EMAIL = 'operator001@elineuque.com';
const TO_EMAIL = 'khaledahmednayeem.dev@gmail.com';
const COMPANY = {
  companyName: 'Makana Ferry Service',
  contactEmail: 'info@makanaferryservice.com',
  businessAddress: 'Blowing Point, Anguilla',
};
const PHONE = '+1 (264) 497-6164';

async function main() {
  const from = await prisma.operatorProfile.findFirstOrThrow({ where: { user: { email: FROM_EMAIL } } });
  const to = await prisma.operatorProfile.findFirstOrThrow({ where: { user: { email: TO_EMAIL } }, include: { user: true } });

  const [ferries, routes, offDays] = await Promise.all([
    prisma.ferry.findMany({ where: { operatorId: from.id }, select: { id: true } }),
    prisma.route.findMany({ where: { operatorId: from.id }, select: { id: true } }),
    prisma.offDay.findMany({ where: { operatorId: from.id }, select: { id: true } }),
  ]);
  const backup = {
    at: new Date().toISOString(),
    fromProfileId: from.id,
    toProfileId: to.id,
    movedFerryIds: ferries.map((f) => f.id),
    movedRouteIds: routes.map((r) => r.id),
    movedOffDayIds: offDays.map((o) => o.id),
    previousToProfile: { companyName: to.companyName, contactEmail: to.contactEmail, businessAddress: to.businessAddress },
    previousToPhone: to.user.phoneNumber,
  };
  const backupPath = path.join(__dirname, 'makana-move-backup.json');
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log('backup written', backupPath);

  const result = await prisma.$transaction(async (tx) => {
    const f = await tx.ferry.updateMany({ where: { operatorId: from.id }, data: { operatorId: to.id } });
    const r = await tx.route.updateMany({ where: { operatorId: from.id }, data: { operatorId: to.id } });
    const o = await tx.offDay.updateMany({ where: { operatorId: from.id }, data: { operatorId: to.id } });
    await tx.operatorProfile.update({ where: { id: to.id }, data: COMPANY });
    await tx.user.update({ where: { id: to.userId }, data: { phoneNumber: PHONE } });
    return { ferries: f.count, routes: r.count, offDays: o.count };
  });
  console.log('moved', result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
