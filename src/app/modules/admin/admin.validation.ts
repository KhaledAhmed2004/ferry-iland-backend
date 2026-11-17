import { z } from 'zod';
import { PaymentStatus, RefundReason, RefundStatus } from '@prisma/client';
import {
  ADMIN_PAYMENT_SORT_FIELDS,
  ADMIN_PAYOUT_SORT_FIELDS,
  ADMIN_REFUND_SORT_FIELDS,
} from './admin.interface';

const updateCommissionZodSchema = z
  .object({
    rate: z.number().min(0).max(100).optional(),
    schedule: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).optional(),
    seatHoldMinutes: z
      .number()
      .int('Seat hold must be a whole number of minutes')
      .min(1, 'Seat hold must be at least 1 minute')
      .max(60, 'Seat hold cannot exceed 60 minutes')
      .optional(),
  })
  .refine(
    data =>
      data.rate !== undefined ||
      data.schedule !== undefined ||
      data.seatHoldMinutes !== undefined,
    { message: 'Provide at least one of rate, schedule, or seatHoldMinutes', path: ['rate'] },
  );

/** Spec 0006, AC-9: a calendar date (UTC day). */
const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-30')
  .refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Not a real date');

const rangeFields = {
  from: ymd.optional(),
  to: ymd.optional(),
  format: z.enum(['json', 'csv']).optional(),
};

const fromBeforeTo = (data: { from?: string; to?: string }) => !data.from || !data.to || data.from <= data.to;
const RANGE_ERROR = { message: 'The start date must be on or before the end date', path: ['from'] };

const pageFields = {
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
};

const search = z.string().trim().max(100).optional();
const operatorId = z.string().uuid('operatorId must be a valid UUID').optional();

const listPaymentsQueryZodSchema = z.object({
  query: z
    .object({
      ...rangeFields,
      ...pageFields,
      status: z.enum(PaymentStatus).optional(),
      operatorId,
      search,
      sortBy: z.enum(ADMIN_PAYMENT_SORT_FIELDS).optional(),
    })
    .refine(fromBeforeTo, RANGE_ERROR),
});

const listRefundsQueryZodSchema = z.object({
  query: z
    .object({
      ...rangeFields,
      ...pageFields,
      status: z.enum(RefundStatus).optional(),
      reason: z.enum(RefundReason).optional(),
      operatorId,
      search,
      sortBy: z.enum(ADMIN_REFUND_SORT_FIELDS).optional(),
    })
    .refine(fromBeforeTo, RANGE_ERROR),
});

const listPayoutsQueryZodSchema = z.object({
  query: z
    .object({
      ...rangeFields,
      operatorId,
      sortBy: z.enum(ADMIN_PAYOUT_SORT_FIELDS).optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    })
    .refine(fromBeforeTo, RANGE_ERROR),
});

const payoutBookingsZodSchema = z.object({
  params: z.object({ operatorId: z.string().uuid('operatorId must be a valid UUID') }),
  query: z
    .object({
      ...rangeFields,
      page: pageFields.page,
      limit: pageFields.limit,
    })
    .refine(fromBeforeTo, RANGE_ERROR),
});

export const AdminValidation = {
  updateCommissionZodSchema,
  listPaymentsQueryZodSchema,
  listRefundsQueryZodSchema,
  listPayoutsQueryZodSchema,
  payoutBookingsZodSchema,
};

export type UpdateCommissionDTO = z.infer<typeof updateCommissionZodSchema>;

