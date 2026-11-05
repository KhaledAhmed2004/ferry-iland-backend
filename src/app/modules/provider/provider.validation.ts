import { z } from 'zod';
import { AccountStatus } from '@prisma/client';
import { PROVIDER_SORT_FIELDS } from './provider.interface';

const listProvidersQueryZodSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      searchTerm: z.string().optional(),
      status: z.enum(AccountStatus).optional(),
      sortBy: z.enum(PROVIDER_SORT_FIELDS).optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    })
    .optional(),
});

const updateProviderStatusZodSchema = z.object({
  body: z.object({
    status: z.enum(AccountStatus),
    reason: z.string().optional(),
  }),
});

const updateOperatorSettingsZodSchema = z.object({
  body: z.object({
    companyName: z.string().min(1, 'Company name is required').optional(),
    contactPersonName: z
      .string()
      .min(1, 'Contact person name is required')
      .optional(),
    contactEmail: z
      .string()
      .email('Valid contact email is required')
      .optional(),
    businessAddress: z.string().optional(),
    // URL written by fileHandler for an uploaded `logo` image.
    logo: z.string().min(1).optional(),
    // multipart sends booleans as text.
    removeLogo: z
      .union([
        z.boolean(),
        z.enum(['true', 'false']).transform(v => v === 'true'),
      ])
      .optional(),
  }),
});

export const ProviderValidation = {
  listProvidersQueryZodSchema,
  updateProviderStatusZodSchema,
  updateOperatorSettingsZodSchema,
};
