import { z } from 'zod';
import { TripStatus } from '@prisma/client';

const createScheduleZodSchema = z.object({
  body: z
    .object({
      routeId: z
        .string({ error: 'routeId is required' })
        .uuid('routeId must be a valid UUID'),
      ferryId: z
        .string({ error: 'ferryId is required' })
        .uuid('ferryId must be a valid UUID'),
      departureTime: z.coerce.date({
        error: 'departureTime must be a valid ISO date',
      }),
      arrivalTime: z.coerce.date({
        error: 'arrivalTime must be a valid ISO date',
      }),
      gate: z.string().trim().max(50).optional(),
      captain: z.string().trim().max(100).optional(),
      adultFare: z
        .number({ error: 'adultFare is required' })
        .min(0, 'adultFare cannot be negative'),
      childFare: z.number().min(0, 'childFare cannot be negative').optional(),
      availableSeats: z
        .number()
        .int()
        .min(1, 'availableSeats must be at least 1')
        .optional(),
    })
    .superRefine((data, ctx) => {
      if (data.departureTime >= data.arrivalTime) {
        ctx.addIssue({
          code: 'custom',
          message: 'arrivalTime must be after departureTime',
          path: ['arrivalTime'],
        });
      }
    }),
});

const updateScheduleZodSchema = z.object({
  body: z
    .object({
      departureTime: z.coerce.date().optional(),
      arrivalTime: z.coerce.date().optional(),
      gate: z.string().trim().max(50).optional(),
      captain: z.string().trim().max(100).optional(),
      adultFare: z.number().min(0).optional(),
      childFare: z.number().min(0).optional(),
      availableSeats: z.number().int().min(0).optional(),
    })
    .superRefine((data, ctx) => {
      if (
        data.departureTime &&
        data.arrivalTime &&
        data.departureTime >= data.arrivalTime
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'arrivalTime must be after departureTime',
          path: ['arrivalTime'],
        });
      }
    }),
});

const updateScheduleStatusZodSchema = z.object({
  body: z.object({
    status: z.enum(TripStatus, {
      error:
        'status must be ON_TIME, PREPARING, BOARDING, DEPARTED, DELAYED, ARRIVED, or CANCELLED',
    }),
  }),
});

const listSchedulesQueryZodSchema = z.object({
  query: z.object({
    routeId: z.string().uuid().optional(),
    ferryId: z.string().uuid().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must follow YYYY-MM-DD')
      .optional(),
    status: z.enum(TripStatus).optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  }),
});

const tripSearchQueryZodSchema = z.object({
  query: z
    .object({
      tripType: z
        .enum(['one-way', 'round-trip'])
        .default('one-way'),
      from: z.string({ error: 'from port is required' }).trim().min(1),
      to: z.string({ error: 'to port is required' }).trim().min(1),
      departureDate: z
        .string({ error: 'departureDate is required' })
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'departureDate must follow YYYY-MM-DD'),
      returnDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'returnDate must follow YYYY-MM-DD')
        .optional(),
      adults: z.coerce.number().int().min(1).default(1),
      children: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(50).default(10),
      cursor: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.from === data.to) {
        ctx.addIssue({
          code: 'custom',
          message: 'Departure port and destination port cannot be the same',
          path: ['to'],
        });
      }

      if (data.tripType === 'round-trip') {
        if (!data.returnDate) {
          ctx.addIssue({
            code: 'custom',
            message: 'returnDate is required for round-trip journeys',
            path: ['returnDate'],
          });
        } else if (data.returnDate < data.departureDate) {
          ctx.addIssue({
            code: 'custom',
            message: 'returnDate must be on or after departureDate',
            path: ['returnDate'],
          });
        }
      }
    }),
});

const bulkDeleteSchedulesZodSchema = z.object({
  body: z.object({
    ids: z
      .array(z.string().min(1, 'Schedule ID cannot be empty'))
      .min(1, 'At least one schedule ID is required for bulk deletion'),
  }),
});

const bulkUpdateScheduleStatusZodSchema = z.object({
  body: z.object({
    ids: z
      .array(z.string().min(1, 'Schedule ID cannot be empty'))
      .min(1, 'At least one schedule ID is required for bulk status update'),
    status: z.enum(TripStatus, {
      error:
        'status must be ON_TIME, PREPARING, BOARDING, DEPARTED, DELAYED, ARRIVED, or CANCELLED',
    }),
  }),
});

export const ScheduleValidation = {
  createScheduleZodSchema,
  updateScheduleZodSchema,
  updateScheduleStatusZodSchema,
  bulkDeleteSchedulesZodSchema,
  bulkUpdateScheduleStatusZodSchema,
  listSchedulesQueryZodSchema,
  tripSearchQueryZodSchema,
};
