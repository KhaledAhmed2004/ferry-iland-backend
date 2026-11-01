import { z } from 'zod';
import { BoardingStatus } from '@prisma/client';

const boardPassengerZodSchema = z.object({
  body: z.object({
    boarded: z.boolean().optional().default(true),
    luggageCount: z
      .number()
      .int()
      .min(0, 'luggageCount cannot be negative')
      .max(10, 'luggageCount cannot exceed 10 bags')
      .optional(),
  }),
});

const manifestQueryZodSchema = z.object({
  query: z.object({
    tripId: z
      .string({ error: 'tripId query parameter is required' })
      .uuid('tripId must be a valid UUID'),
    search: z.string().trim().optional(),
    boardingStatus: z.enum(BoardingStatus).optional(),
  }),
});

export const TicketValidation = {
  boardPassengerZodSchema,
  manifestQueryZodSchema,
};
