import { z } from 'zod';
import { TripStatus } from '@prisma/client';

/**
 * A schedule time: a port local wall time (`2026-11-06T08:30`, read in the route's port zone)
 * or an exact instant with `Z` or an offset. Kept as text here; the service converts it with the
 * port zone and then checks arrival after departure (spec 0003, AC-6 and rule 8).
 */
const SCHEDULE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:[zZ]|[+-]\d{2}:?\d{2})?$/;
const scheduleTimeSchema = (field: string) =>
  z
    .string({ error: `${field} is required` })
    .trim()
    .regex(SCHEDULE_TIME, `${field} must be a local date time (YYYY-MM-DDTHH:mm) or an ISO instant`);

const createScheduleZodSchema = z.object({
  body: z
    .object({
      routeId: z
        .string({ error: 'routeId is required' })
        .uuid('routeId must be a valid UUID'),
      ferryId: z
        .string({ error: 'ferryId is required' })
        .uuid('ferryId must be a valid UUID'),
      departureTime: scheduleTimeSchema('departureTime'),
      arrivalTime: scheduleTimeSchema('arrivalTime'),
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
    }),
});

const updateScheduleZodSchema = z.object({
  body: z
    .object({
      departureTime: scheduleTimeSchema('departureTime').optional(),
      arrivalTime: scheduleTimeSchema('arrivalTime').optional(),
      gate: z.string().trim().max(50).optional(),
      captain: z.string().trim().max(100).optional(),
      adultFare: z.number().min(0).optional(),
      childFare: z.number().min(0).optional(),
      availableSeats: z.number().int().min(0).optional(),
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
        .enum(['one-way', 'round-trip', 'same-day-return'])
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

      // Same day return comes back on the departure date; returnDate may be left out.
      if (
        data.tripType === 'same-day-return' &&
        data.returnDate &&
        data.returnDate !== data.departureDate
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'A same day return must come back on the departure date',
          path: ['returnDate'],
        });
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
