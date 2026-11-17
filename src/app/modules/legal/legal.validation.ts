import { z } from 'zod';

const createLegalPage = z.object({
  body: z.object({
    title: z
      .string({ required_error: 'Title is required' })
      .trim()
      .min(1, 'Title cannot be empty')
      .max(200, 'Title cannot exceed 200 characters'),
    slug: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Slug must be lowercase alphanumeric with hyphens (e.g. terms-of-service)',
      )
      .optional(),
    content: z
      .string({ required_error: 'Content is required' })
      .min(1, 'Content cannot be empty'),
    isPublished: z.boolean().optional().default(true),
  }),
});

const updateLegalPage = z.object({
  params: z.object({
    id: z.string().uuid({ message: 'Invalid ID format' }),
  }),
  body: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    slug: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Slug must be lowercase alphanumeric with hyphens (e.g. terms-of-service)',
      )
      .optional(),
    content: z.string().min(1).optional(),
    isPublished: z.boolean().optional(),
  }),
});

const getLegalPage = z.object({
  params: z.object({
    identifier: z.string().min(1, 'Identifier is required'),
  }),
});

const deleteLegalPage = z.object({
  params: z.object({
    id: z.string().uuid({ message: 'Invalid ID format' }),
  }),
});

export const LegalValidation = {
  createLegalPage,
  getLegalPage,
  updateLegalPage,
  deleteLegalPage,
};
