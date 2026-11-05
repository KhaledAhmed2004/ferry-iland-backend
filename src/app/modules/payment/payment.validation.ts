import { z } from 'zod';

// The guest email is a plain string, not an email format check: a wrong or malformed email
// must answer 404 like any other mismatch, so the booking is not revealed (spec 0002, AC-2).
const guestEmail = z.string().trim().max(254).optional();

const createPaymentIntentZodSchema = z.object({
  body: z.object({
    bookingId: z.string({ error: 'Booking id is required' }).uuid('Booking id must be a UUID'),
    email: guestEmail,
  }),
});

const syncPaymentZodSchema = z.object({
  params: z.object({
    bookingId: z.string().uuid('Booking id must be a UUID'),
  }),
  body: z
    .object({
      email: guestEmail,
    })
    .optional()
    .default({}),
});

export const PaymentValidation = {
  createPaymentIntentZodSchema,
  syncPaymentZodSchema,
};
