import config from '../config';
import { Role, AccountStatus } from '@prisma/client';
import { logger } from '../shared/logger';
import { prisma } from '../shared/prisma';
import bcrypt from 'bcrypt';

export const seedAdmin = async () => {
  if (!config.admin.email || !config.admin.password) return;
  const isExistAdmin = await prisma.user.findFirst({
    where: {
      email: config.admin.email.toLowerCase().trim(),
      role: Role.ADMIN,
    },
  });
  if (!isExistAdmin) {
    const hashedPassword = await bcrypt.hash(
      config.admin.password,
      Number(config.bcrypt_salt_rounds),
    );
    await prisma.user.create({
      data: {
        name: 'Administrator',
        email: config.admin.email.toLowerCase().trim(),
        role: Role.ADMIN,
        passwordHash: hashedPassword,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
        isRootAdmin: true,
      },
    });
    logger.info('✨ Admin account has been successfully created!');
  }
};
