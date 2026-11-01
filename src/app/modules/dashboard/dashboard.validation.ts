import { z } from 'zod';

const monthlyTrendsQuerySchema = z.object({
  query: z.object({
    year: z
      .union([z.string(), z.number()])
      .refine(
        val =>
          !isNaN(Number(val)) && Number(val) >= 2000 && Number(val) <= 2100,
        {
          message: 'Year must be a valid 4-digit year between 2000 and 2100',
        },
      )
      .optional(),
    range: z.enum(['3m', '6m', '12m', 'this-year']).optional(),
    metric: z.enum(['all', 'jobs', 'items']).optional(),
  }),
});

const recentActivitiesQuerySchema = z.object({
  query: z.object({
    limit: z
      .union([z.string(), z.number()])
      .refine(
        val => !isNaN(Number(val)) && Number(val) >= 1 && Number(val) <= 50,
        {
          message: 'Limit must be a positive integer between 1 and 50',
        },
      )
      .optional(),
  }),
});

export const DashboardValidation = {
  monthlyTrendsQuerySchema,
  recentActivitiesQuerySchema,
};
