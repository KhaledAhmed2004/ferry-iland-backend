import { z } from 'zod';
import { ADMIN_PAYMENT_SORT_FIELDS } from './admin.interface';

const updateCommissionZodSchema = z
  .object({
    rate: z.number().min(0).max(100).optional(),
    schedule: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).optional(),
    seatHoldMinutes: z
      .number()
      .int('Seat hold must be a whole number of minutes')
      .min(1, 'Seat hold must be at least 1 minute')
      .max(60, 'Seat hold cannot exceed 60 minutes')
      .optional(),
  })
  .refine(
    data =>
      data.rate !== undefined ||
      data.schedule !== undefined ||
      data.seatHoldMinutes !== undefined,
    { message: 'Provide at least one of rate, schedule, or seatHoldMinutes', path: ['rate'] },
  );

const updatePlatformZodSchema = z.object({
  name: z.string().min(1, 'Platform name cannot be empty').optional(),
  email: z.email('Valid support email required').optional(),
});

const listPaymentsQueryZodSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      searchTerm: z.string().optional(),
      sortBy: z.enum(ADMIN_PAYMENT_SORT_FIELDS).optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    })
    .optional(),
});

export const AdminValidation = {
  updateCommissionZodSchema,
  updatePlatformZodSchema,
  listPaymentsQueryZodSchema,
};

export type UpdateCommissionDTO = z.infer<typeof updateCommissionZodSchema>;
export type UpdatePlatformDTO = z.infer<typeof updatePlatformZodSchema>;
export type ListPaymentsQueryDTO = z.infer<typeof listPaymentsQueryZodSchema>;

