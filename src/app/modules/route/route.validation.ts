import { z } from 'zod';
import { RouteStatus } from '@prisma/client';

/** Bundle fare per passenger; null (or left out on create) = option not offered on this route. */
const bundleFare = z.number().min(0, 'Fare cannot be negative').nullable().optional();
const bundleFareFields = {
  adultRoundTripFare: bundleFare,
  childRoundTripFare: bundleFare,
  adultSameDayFare: bundleFare,
  childSameDayFare: bundleFare,
};

const createRouteZodSchema = z.object({
  body: z
    .object({
      departurePortId: z
        .string({ error: 'departurePortId is required' })
        .min(1, 'departurePortId is required'),
      destinationPortId: z
        .string({ error: 'destinationPortId is required' })
        .min(1, 'destinationPortId is required'),
      durationMinutes: z
        .number({ error: 'durationMinutes must be a number' })
        .int('durationMinutes must be an integer')
        .min(1, 'durationMinutes must be at least 1 minute')
        .max(1440, 'durationMinutes cannot exceed 1440 minutes (24 hours)'),
      basePrice: z.number().min(0, 'basePrice cannot be negative').optional().default(30),
      ...bundleFareFields,
      description: z
        .string({ error: 'description is required' })
        .trim()
        .min(1, 'description is required')
        .max(1000, 'description cannot exceed 1000 characters'),
      amenities: z.array(z.string().trim()).optional().default([]),
      imageUrl: z
        .string({ error: 'imageUrl is required' })
        .trim()
        .min(1, 'imageUrl is required'),
      isBorderCrossing: z.boolean().optional().default(false),
      status: z
        .enum([RouteStatus.ACTIVE, RouteStatus.INACTIVE], {
          error: 'status must be ACTIVE or INACTIVE',
        })
        .optional()
        .default(RouteStatus.ACTIVE),
    })
    .superRefine((data, ctx) => {
      if (data.departurePortId === data.destinationPortId) {
        ctx.addIssue({
          code: 'custom',
          message: 'Departure port and destination port cannot be the same',
          path: ['destinationPortId'],
        });
      }
    }),
});

const updateRouteZodSchema = z.object({
  body: z.object({
    durationMinutes: z
      .number({ error: 'durationMinutes must be a number' })
      .int('durationMinutes must be an integer')
      .min(1, 'durationMinutes must be at least 1 minute')
      .max(1440, 'durationMinutes cannot exceed 1440 minutes (24 hours)')
      .optional(),
    basePrice: z.number().min(0).optional(),
    ...bundleFareFields,
    description: z
      .string()
      .trim()
      .min(1, 'description cannot be empty')
      .max(1000, 'description cannot exceed 1000 characters')
      .optional(),
    amenities: z.array(z.string().trim()).optional(),
    imageUrl: z.string().trim().min(1, 'imageUrl cannot be empty').optional(),
    isBorderCrossing: z.boolean().optional(),
    status: z
      .enum([RouteStatus.ACTIVE, RouteStatus.INACTIVE], {
        error: 'status must be ACTIVE or INACTIVE',
      })
      .optional(),
  }),
});

const listRoutesQueryZodSchema = z.object({
  query: z.object({
    page: z.coerce
      .number({ error: 'page must be a number' })
      .int()
      .min(1, 'page must be at least 1')
      .optional()
      .default(1),
    limit: z.coerce
      .number({ error: 'limit must be a number' })
      .int()
      .min(1, 'limit must be at least 1')
      .max(100, 'limit cannot exceed 100')
      .optional()
      .default(10),
    status: z
      .enum([RouteStatus.ACTIVE, RouteStatus.INACTIVE], {
        error: 'status must be ACTIVE or INACTIVE',
      })
      .optional(),
  }),
});

const popularRoutesQueryZodSchema = z.object({
  query: z.object({
    limit: z.coerce
      .number({ error: 'limit must be a number' })
      .int()
      .min(1, 'limit must be at least 1')
      .max(100, 'limit cannot exceed 100')
      .optional()
      .default(4),
  }),
});

const bulkUpdateRouteStatusZodSchema = z.object({
  body: z.object({
    ids: z
      .array(z.string().min(1, 'Each ID must be a non-empty string'), {
        error: 'ids must be an array of strings',
      })
      .min(1, 'At least one route ID must be provided'),
    status: z.enum([RouteStatus.ACTIVE, RouteStatus.INACTIVE], {
      error: 'status must be ACTIVE or INACTIVE',
    }),
  }),
});

const bulkDeleteRoutesZodSchema = z.object({
  body: z.object({
    ids: z
      .array(z.string().min(1, 'Each ID must be a non-empty string'), {
        error: 'ids must be an array of strings',
      })
      .min(1, 'At least one route ID must be provided'),
  }),
});

export const RouteValidation = {
  createRouteZodSchema,
  updateRouteZodSchema,
  listRoutesQueryZodSchema,
  popularRoutesQueryZodSchema,
  bulkUpdateRouteStatusZodSchema,
  bulkDeleteRoutesZodSchema,
};

export type ICreateRouteReq = z.input<typeof createRouteZodSchema>['body'];
export type IUpdateRouteReq = z.infer<typeof updateRouteZodSchema>['body'];
export type IBulkUpdateRouteStatusReq = z.infer<typeof bulkUpdateRouteStatusZodSchema>['body'];
export type IBulkDeleteRoutesReq = z.infer<typeof bulkDeleteRoutesZodSchema>['body'];
export type IListRoutesQuery = z.input<typeof listRoutesQueryZodSchema>['query'];
export type IPopularRoutesQuery = z.infer<typeof popularRoutesQueryZodSchema>['query'];
