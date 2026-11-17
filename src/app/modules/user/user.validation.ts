import { z } from 'zod';
import { AccountStatus } from '@prisma/client';

const phoneRegex = /^\+?[0-9]{7,15}$/;

const updateProfileZodSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .min(2, 'Name must be at least 2 characters long')
        .optional(),
      email: z.string().email('Invalid email address').optional(),
      phoneNumber: z
        .string()
        .regex(phoneRegex, 'Invalid phone number format')
        .optional()
        .nullable(),
      phone: z
        .string()
        .regex(phoneRegex, 'Invalid phone number format')
        .optional()
        .nullable(),
      companyName: z.string().min(1).optional(),
      contactPersonName: z.string().min(1).optional(),
      profilePicture: z.string().optional(),
    })
    .passthrough(),
});

const updatePasswordZodSchema = z.object({
  body: z
    .object({
      oldPassword: z.string().min(1, 'Old password is required').optional(),
      currentPassword: z.string().min(1).optional(),
      newPassword: z
        .string()
        .min(8, 'New password must be at least 8 characters long'),
    })
    .refine(data => data.oldPassword || data.currentPassword, {
      message: 'Current password is required',
      path: ['oldPassword'],
    }),
});

const updateStatusZodSchema = z.object({
  body: z.object({
    status: z.enum(AccountStatus).optional(),
    reason: z.string().max(500).optional(),
  }),
});

export const UserValidation = {
  updateProfileZodSchema,
  updatePasswordZodSchema,
  updateStatusZodSchema,
};
