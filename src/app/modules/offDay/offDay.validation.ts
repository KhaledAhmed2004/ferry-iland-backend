import { z } from 'zod';
import { OffDayCategory } from '@prisma/client';

const createOffDayZodSchema = z.object({
  body: z.object({
    date: z.coerce.date({ error: 'Valid date is required' }),
    reason: z
      .string({ error: 'Reason is required' })
      .trim()
      .min(3, 'Reason must be at least 3 characters')
      .max(255, 'Reason cannot exceed 255 characters'),
    category: z
      .enum(OffDayCategory, {
        error: 'Category must be MAINTENANCE, WEATHER, or PUBLIC_HOLIDAY',
      })
      .optional()
      .default(OffDayCategory.MAINTENANCE),
    ferryId: z.string().uuid('ferryId must be a valid UUID').optional(),
  }),
});

const updateOffDayZodSchema = z.object({
  body: z.object({
    date: z.coerce.date().optional(),
    reason: z
      .string()
      .trim()
      .min(3, 'Reason must be at least 3 characters')
      .max(255, 'Reason cannot exceed 255 characters')
      .optional(),
    category: z
      .enum(OffDayCategory, {
        error: 'Category must be MAINTENANCE, WEATHER, or PUBLIC_HOLIDAY',
      })
      .optional(),
    ferryId: z.string().uuid().optional(),
  }),
});

const listOffDaysQueryZodSchema = z.object({
  query: z.object({
    year: z.coerce.number().int().min(2020).max(2100).optional(),
    ferryId: z.string().uuid().optional(),
    category: z.enum(OffDayCategory).optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  }),
});

export const OffDayValidation = {
  createOffDayZodSchema,
  updateOffDayZodSchema,
  listOffDaysQueryZodSchema,
};
