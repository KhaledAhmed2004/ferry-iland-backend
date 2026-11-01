import { z } from 'zod';

const objectIdValidator = z
  .string({ error: 'Legal ID is required' })
  .regex(/^[0-9a-fA-F]{24}$/, { message: 'Invalid MongoDB ObjectId format' });

const createLegalPage = z.object({
  body: z.object({
    title: z.string({ error: 'Title is required' }).trim().min(1).max(200),
    content: z.string().max(100000, 'Content cannot exceed 100,000 characters').optional(),
  }),
});

const getLegalPage = z.object({
  params: z.object({
    legalId: objectIdValidator,
  }),
});

const updateLegalPage = z.object({
  params: z.object({
    legalId: objectIdValidator,
  }),
  body: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().max(100000, 'Content cannot exceed 100,000 characters').optional(),
  }),
});

const deleteLegalPage = z.object({
  params: z.object({
    legalId: objectIdValidator,
  }),
});

export const LegalValidation = {
  createLegalPage,
  getLegalPage,
  updateLegalPage,
  deleteLegalPage,
};



