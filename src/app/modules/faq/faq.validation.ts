import { z } from 'zod';

const createFaqZodSchema = z.object({
  body: z.object({
    question: z
      .string({ error: 'Question is required' })
      .trim()
      .min(3, 'Question must be at least 3 characters')
      .max(500, 'Question cannot exceed 500 characters'),
    answer: z
      .string({ error: 'Answer is required' })
      .trim()
      .min(3, 'Answer must be at least 3 characters'),
    category: z.string().trim().optional().default('Booking'),
    isPublished: z.boolean().optional().default(true),
    order: z.coerce.number().int().optional().default(0),
  }),
});

const updateFaqZodSchema = z.object({
  body: z.object({
    question: z
      .string()
      .trim()
      .min(3, 'Question must be at least 3 characters')
      .max(500, 'Question cannot exceed 500 characters')
      .optional(),
    answer: z
      .string()
      .trim()
      .min(3, 'Answer must be at least 3 characters')
      .optional(),
    category: z.string().trim().optional(),
    isPublished: z.boolean().optional(),
    order: z.coerce.number().int().optional(),
  }),
});

const listFaqsQueryZodSchema = z.object({
  query: z.object({
    search: z.string().trim().optional(),
    category: z.string().trim().optional(),
    isPublished: z
      .enum(['true', 'false'])
      .transform(value => value === 'true')
      .optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(0).max(100).optional().default(20),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  }),
});


const bulkPublishZodSchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1, 'At least one FAQ ID is required'),
    isPublished: z.boolean(),
  }),
});

const bulkCategoryZodSchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1, 'At least one FAQ ID is required'),
    category: z.string().trim().min(1, 'Category is required'),
  }),
});

const bulkDeleteZodSchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1, 'At least one FAQ ID is required'),
  }),
});

export const FaqValidation = {
  createFaqZodSchema,
  updateFaqZodSchema,
  listFaqsQueryZodSchema,
  bulkPublishZodSchema,
  bulkCategoryZodSchema,
  bulkDeleteZodSchema,
};
