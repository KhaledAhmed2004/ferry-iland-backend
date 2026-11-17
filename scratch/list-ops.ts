import prisma from '../src/shared/prisma';
(async () => {
  const ops = await prisma.operatorProfile.findMany({ include: { user: { select: { email: true, createdAt: true } }, _count: { select: { routes: true, ferries: true } } } });
  for (const o of ops) console.log(o.id, '|', o.companyName, '|', o.user.email, '|', o.user.createdAt.toISOString(), '| routes', o._count.routes, 'ferries', o._count.ferries);
  const users = await prisma.user.findMany({ select: { email: true, role: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
  console.log('USERS', users.length); for (const u of users) console.log(' ', u.role, u.email, u.createdAt.toISOString());
  await prisma.$disconnect();
})();
