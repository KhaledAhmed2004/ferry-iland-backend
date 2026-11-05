import { z } from 'zod';
import { BookingStatus, CabinClass, TripType } from '@prisma/client';

const passengerInputZodSchema = z.object({
  passengerName: z
    .string({ error: 'Passenger name is required' })
    .trim()
    .min(2, 'Passenger name must be at least 2 characters')
    .max(100, 'Passenger name cannot exceed 100 characters'),
  nationality: z
    .string({ error: 'Nationality is required' })
    .trim()
    .min(2, 'Nationality must be at least 2 characters')
    .max(50, 'Nationality cannot exceed 50 characters')
    .toUpperCase(),
  passportOrId: z
    .string({ error: 'Passport or ID number is required' })
    .trim()
    .min(3, 'Passport or ID must be at least 3 characters')
    .max(50, 'Passport or ID cannot exceed 50 characters')
    .toUpperCase(),
  cabinClass: z
    .enum(CabinClass, {
      error: 'Cabin class must be STANDARD, BUSINESS, or VIP',
    })
    .optional()
    .default(CabinClass.STANDARD),
  luggageCount: z
    .number()
    .int()
    .min(0, 'Luggage count cannot be negative')
    .max(10, 'Luggage count cannot exceed 10 bags per passenger')
    .optional()
    .default(0),
});

const createBookingZodSchema = z.object({
  body: z
    .object({
      scheduleId: z
        .string({ error: 'scheduleId is required' })
        .uuid('scheduleId must be a valid UUID'),
      tripType: z
        .enum(TripType, {
          error: 'tripType must be ONE_WAY, ROUND_TRIP, or SAME_DAY_RETURN',
        })
        .optional()
        .default(TripType.ONE_WAY),
      returnScheduleId: z
        .string()
        .uuid('returnScheduleId must be a valid UUID')
        .optional(),
      leadPassengerName: z
        .string({ error: 'Lead passenger name is required' })
        .trim()
        .min(2, 'Lead passenger name must be at least 2 characters')
        .max(100, 'Lead passenger name cannot exceed 100 characters'),
      leadPassengerEmail: z
        .string({ error: 'Lead passenger email is required' })
        .email('Valid email address is required')
        .toLowerCase(),
      leadPassengerPhone: z.string().trim().max(30).optional(),
      adultsCount: z
        .number({ error: 'adultsCount is required' })
        .int('adultsCount must be an integer')
        .min(1, 'At least 1 adult passenger is required')
        .max(20, 'Maximum 20 passengers per booking'),
      childrenCount: z
        .number()
        .int('childrenCount must be an integer')
        .min(0, 'childrenCount cannot be negative')
        .max(15, 'Maximum 15 child passengers per booking')
        .optional()
        .default(0),
      passengers: z
        .array(passengerInputZodSchema)
        .min(1, 'At least one passenger record is required'),
    })
    .superRefine((data, ctx) => {
      const totalRequiredPassengers =
        data.adultsCount + (data.childrenCount ?? 0);

      if (data.passengers.length !== totalRequiredPassengers) {
        ctx.addIssue({
          code: 'custom',
          message: `Expected ${totalRequiredPassengers} passenger details, but received ${data.passengers.length}`,
          path: ['passengers'],
        });
      }

      if (data.tripType === TripType.ONE_WAY && data.returnScheduleId) {
        ctx.addIssue({
          code: 'custom',
          message: 'A one way booking cannot have a returnScheduleId',
          path: ['returnScheduleId'],
        });
      }

      if (data.tripType !== TripType.ONE_WAY && !data.returnScheduleId) {
        ctx.addIssue({
          code: 'custom',
          message: 'returnScheduleId is required for a return trip',
          path: ['returnScheduleId'],
        });
      }
    }),
});

const listBookingsQueryZodSchema = z.object({
  query: z.object({
    status: z.enum(BookingStatus).optional(),
    search: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  }),
});

export const BookingValidation = {
  createBookingZodSchema,
  listBookingsQueryZodSchema,
};
