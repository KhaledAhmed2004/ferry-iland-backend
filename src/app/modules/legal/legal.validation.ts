import { z } from 'zod';

const updateLegalPage = z.object({
  params: z.object({
    legalId: z.string().uuid({ message: 'Invalid ID format' }),
  }),
  body: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().min(1).optional(),
    isPublished: z.boolean().optional(),
  }),
});

const getLegalPage = z.object({
  params: z.object({
    identifier: z.string().min(1, 'Identifier is required'),
  }),
});

export const LegalValidation = {
  getLegalPage,
  updateLegalPage,
};
