import { z } from 'zod';
import { AccountStatus } from '@prisma/client';

const updateProviderStatusZodSchema = z.object({
  body: z.object({
    status: z.enum(AccountStatus),
    reason: z.string().optional(),
  }),
});

const updateOperatorSettingsZodSchema = z.object({
  body: z.object({
    companyName: z.string().min(1, 'Company name is required').optional(),
    contactPersonName: z.string().min(1, 'Contact person name is required').optional(),
    contactEmail: z.string().email('Valid contact email is required').optional(),
    businessAddress: z.string().optional(),
  }),
});

export const ProviderValidation = {
  updateProviderStatusZodSchema,
  updateOperatorSettingsZodSchema,
};
