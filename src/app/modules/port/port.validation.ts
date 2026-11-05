import { z } from 'zod';
import { isValidTimeZone } from '../../../shared/portTime';

// IANA zone name; trip times at this port are shown and read in it (spec 0003).
const timeZoneSchema = z
  .string({ error: 'Time zone is required' })
  .trim()
  .refine(isValidTimeZone, 'Invalid time zone');

const createPortZodSchema = z.object({
  body: z.object({
    name: z
      .string({ error: 'Port name is required' })
      .trim()
      .min(2, 'Port name must be at least 2 characters')
      .max(100, 'Port name cannot exceed 100 characters'),
    timeZone: timeZoneSchema,
    isActive: z.boolean().optional().default(true),
  }),
});

const updatePortZodSchema = z.object({
  body: z.object({
    name: z
      .string()
      .trim()
      .min(2, 'Port name must be at least 2 characters')
      .max(100, 'Port name cannot exceed 100 characters')
      .optional(),
    timeZone: timeZoneSchema.optional(),
    isActive: z.boolean().optional(),
  }),
});

const listPortsQueryZodSchema = z.object({
  query: z.object({
    search: z.string().trim().optional(),
    isActive: z
      .enum(['true', 'false'])
      .transform(value => value === 'true')
      .optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  }),
});

export const PortValidation = {
  createPortZodSchema,
  updatePortZodSchema,
  listPortsQueryZodSchema,
};
