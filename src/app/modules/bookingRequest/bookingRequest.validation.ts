import { z } from 'zod';
import { BookingRequestStatus } from '@prisma/client';

const listBookingRequestsQueryZodSchema = z.object({
  query: z.object({
    status: z.enum(BookingRequestStatus).optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  }),
});

/** Spec 0004, AC-8 and AC-10. A reject must say why, since the customer reads the note. */
const resolveBookingRequestZodSchema = z.object({
  params: z.object({ id: z.string().uuid('Request id must be a valid UUID') }),
  body: z
    .object({
      action: z.enum(['CANCEL', 'RESCHEDULE', 'REJECT'], {
        error: 'action must be CANCEL, RESCHEDULE, or REJECT',
      }),
      outboundScheduleId: z.string().uuid('outboundScheduleId must be a valid UUID').optional(),
      returnScheduleId: z.string().uuid('returnScheduleId must be a valid UUID').optional(),
      note: z.string().trim().max(500, 'Note cannot exceed 500 characters').optional(),
    })
    .superRefine((data, ctx) => {
      if (data.action === 'REJECT' && !data.note) {
        ctx.addIssue({
          code: 'custom',
          message: 'Please tell the customer why the request is rejected',
          path: ['note'],
        });
      }
      if (data.action === 'RESCHEDULE' && !data.outboundScheduleId && !data.returnScheduleId) {
        ctx.addIssue({
          code: 'custom',
          message: 'Choose a new trip for at least one leg',
          path: ['outboundScheduleId'],
        });
      }
    }),
});

export const BookingRequestValidation = {
  listBookingRequestsQueryZodSchema,
  resolveBookingRequestZodSchema,
};
