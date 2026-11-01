import { z } from 'zod';
import { Role, AccountStatus } from '@prisma/client';

const phoneRegex = /^\+?[0-9]{7,15}$/;

// Mirrors NestJS UpdateProfileDto (min 2 chars name) + optional phone/operator details
const updateProfileZodSchema = z.object({
  body: z
    .object({
      name: z.string().min(2, 'Name must be at least 2 characters long').optional(),
      email: z.string().email('Invalid email address').optional(),
      phoneNumber: z.string().regex(phoneRegex, 'Invalid phone number format').optional().nullable(),
      phone: z.string().regex(phoneRegex, 'Invalid phone number format').optional().nullable(),
      companyName: z.string().min(1).optional(),
      contactPersonName: z.string().min(1).optional(),
      profilePicture: z.string().optional(),
    })
    .passthrough(),
});

// Mirrors NestJS UpdatePasswordDto (oldPassword required, newPassword min 8)
const updatePasswordZodSchema = z.object({
  body: z
    .object({
      oldPassword: z.string().min(1, 'Old password is required').optional(),
      currentPassword: z.string().min(1).optional(),
      newPassword: z
        .string()
        .min(8, 'New password must be at least 8 characters long'),
    })
    .refine((data) => data.oldPassword || data.currentPassword, {
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

const suspendUserZodSchema = z.object({
  body: z.object({
    reason: z.string().max(500).optional(),
  }),
});

const blockUserZodSchema = suspendUserZodSchema;
const rejectUserZodSchema = suspendUserZodSchema;

const deleteUserZodSchema = z.object({
  body: z.object({
    password: z.string().optional(),
  }),
});

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;

// Mirrors NestJS RegisterDto / User creation
const createUserZodSchema = z.object({
  body: z
    .object({
      name: z.string().min(2, 'Name must be at least 2 characters long').optional(),
      email: z.string().min(1, 'Email is required').email('Invalid email address'),
      password: z
        .string()
        .min(8, 'Password must be at least 8 characters long')
        .regex(
          passwordRegex,
          'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
        ),
      phone: z.string().regex(phoneRegex, 'Invalid phone number format').optional(),
      phoneNumber: z.string().regex(phoneRegex, 'Invalid phone number format').optional(),
      role: z
        .enum(Role)
        .optional()
        .default(Role.USER),
      companyName: z.string().optional(),
      contactPersonName: z.string().optional(),
      profilePicture: z.string().optional(),
    })
    .passthrough()
    .superRefine((data, ctx) => {
      if (data.role === Role.OPERATOR) {
        if (!data.companyName) {
          ctx.addIssue({
            code: 'custom',
            message: 'companyName is required for operator',
            path: ['companyName'],
          });
        }
      } else {
        if (!data.name || !data.name.trim()) {
          ctx.addIssue({
            code: 'custom',
            message: 'Name is required',
            path: ['name'],
          });
        }
      }
      if (!data.phone && !data.phoneNumber) {
        ctx.addIssue({
          code: 'custom',
          message: 'Phone is required',
          path: ['phone'],
        });
      }
    }),
});

export const UserValidation = {
  updateProfileZodSchema,
  updateUserZodSchema: updateProfileZodSchema,
  updatePasswordZodSchema,
  updateStatusZodSchema,
  suspendUserZodSchema,
  blockUserZodSchema,
  rejectUserZodSchema,
  deleteUserZodSchema,
  createUserZodSchema,
};
