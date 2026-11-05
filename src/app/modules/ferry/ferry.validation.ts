import { z } from 'zod';
import { VesselStatus, VesselType } from '@prisma/client';
import { validateBody, validateQuery } from '../../../helpers/zodHelper';

const createFerryZodSchema = validateBody({
  name: z
    .string({ error: 'Ferry name is required' })
    .trim()
    .min(2, 'Ferry name must be at least 2 characters')
    .max(100, 'Ferry name cannot exceed 100 characters'),
  capacity: z
    .number({ error: 'Capacity is required' })
    .int('Capacity must be an integer')
    .min(5, 'Capacity must be at least 5 seats')
    .max(1500, 'Capacity cannot exceed 1500 seats'),
  type: z
    .enum(VesselType, {
      error: 'Type must be CATAMARAN, SPEEDBOAT, or TRADITIONAL_FERRY',
    })
    .optional()
    .default(VesselType.CATAMARAN),
  status: z
    .enum(VesselStatus, {
      error: 'Status must be IN_SERVICE, MAINTENANCE, or OUT_OF_SERVICE',
    })
    .optional()
    .default(VesselStatus.IN_SERVICE),
  imageUrl: z.string().trim().optional(),
  amenities: z.array(z.string()).optional(),
});

const updateFerryZodSchema = validateBody({
  name: z
    .string()
    .trim()
    .min(2, 'Ferry name must be at least 2 characters')
    .max(100, 'Ferry name cannot exceed 100 characters')
    .optional(),
  capacity: z
    .number()
    .int('Capacity must be an integer')
    .min(5, 'Capacity must be at least 5 seats')
    .max(1500, 'Capacity cannot exceed 1500 seats')
    .optional(),
  type: z
    .enum(VesselType, {
      error: 'Type must be CATAMARAN, SPEEDBOAT, or TRADITIONAL_FERRY',
    })
    .optional(),
  status: z
    .enum(VesselStatus, {
      error: 'Status must be IN_SERVICE, MAINTENANCE, or OUT_OF_SERVICE',
    })
    .optional(),
  imageUrl: z.string().trim().optional(),
  amenities: z.array(z.string()).optional(),
});

const listFerriesQueryZodSchema = validateQuery({
  search: z.string().trim().optional(),
  status: z.enum(VesselStatus).optional(),
  type: z.enum(VesselType).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const FerryValidation = {
  createFerryZodSchema,
  updateFerryZodSchema,
  listFerriesQueryZodSchema,
};
