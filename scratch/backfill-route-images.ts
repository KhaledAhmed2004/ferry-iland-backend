/**
 * Dev DB backfill (2026-11-15): give every route that lacks one an image (destination port
 * photo) and a description. Existing values are never overwritten.
 * Usage: npx tsx scratch/backfill-route-images.ts
 */
import prisma from '../src/shared/prisma';
import { getDynamicPortImage } from '../src/shared/mediaCatalog';
import { describeRoute } from '../src/shared/routeDescription';

const blank = (s: string | null) => !s || !s.trim();

(async () => {
  const routes = await prisma.route.findMany({ include: { departurePort: true, destinationPort: true } });
  let images = 0;
  let descriptions = 0;
  for (const r of routes) {
    const data: { imageUrl?: string; description?: string } = {};
    if (blank(r.imageUrl)) (data.imageUrl = getDynamicPortImage(r.destinationPort.name)), images++;
    if (blank(r.description))
      (data.description = describeRoute(r.departurePort.name, r.destinationPort.name, r.durationMinutes)),
        descriptions++;
    if (Object.keys(data).length) await prisma.route.update({ where: { id: r.id }, data });
  }
  const missing = await prisma.route.count({
    where: { OR: [{ imageUrl: null }, { imageUrl: '' }, { description: null }, { description: '' }] },
  });
  console.log(`images set: ${images}, descriptions set: ${descriptions}; routes still incomplete: ${missing}`);
})().finally(() => prisma.$disconnect());
