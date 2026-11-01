import { z } from 'zod';

const rewardSplitPayloadSchema = z.object({
  body: z.object({
    promoter: z.number().min(0).max(100),
    customer: z.number().min(0).max(100),
    platform: z.number().min(0).max(100),
  }).refine((data) => data.promoter + data.customer + data.platform === 100, {
    message: 'The sum of promoter, customer, and platform percentages must exactly equal 100',
    path: ['promoter'],
  }),
});

export const SettingValidation = {
  rewardSplitPayloadSchema,
};
