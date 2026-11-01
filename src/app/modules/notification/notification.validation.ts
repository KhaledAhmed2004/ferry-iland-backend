import { z } from 'zod';

const objectIdValidator = z
  .string({ error: 'Notification ID is required' })
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId format');

export const listNotificationsSchema = z.object({
  query: z
    .object({
      limit: z.string().optional(),
      page: z.string().optional(),
      cursor: z
        .string()
        .refine(val => val === '' || /^[0-9a-fA-F]{24}$/.test(val), {
          message: 'Invalid cursor format',
        })
        .optional(),
    })
    .optional(),
});

export const markAllReadSchema = z.object({});

export const paramIdSchema = z.object({
  params: z.object({
    notificationId: objectIdValidator,
  }),
});

export const markReadSchema = z.object({
  params: z.object({
    notificationId: objectIdValidator,
  }),
  body: z
    .object({
      read: z.boolean().optional(),
    })
    .optional(),
});

export const NotificationValidation = {
  listNotificationsSchema,
  markAllReadSchema,
  paramIdSchema,
  markReadSchema,
};
