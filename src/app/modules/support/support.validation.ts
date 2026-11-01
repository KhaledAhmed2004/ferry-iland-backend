import { z } from 'zod';

const createSupportZodSchema = z.object({
  body: z.object({
    subject: z.string().min(1, 'Subject is required'),
    message: z.string().min(1, 'Message is required'),
  }),
});

const addMessageZodSchema = z.object({
  body: z.object({
    message: z.string().min(1, 'Message is required'),
  }),
});

export const SupportValidation = {
  createSupportZodSchema,
  addMessageZodSchema,
};
