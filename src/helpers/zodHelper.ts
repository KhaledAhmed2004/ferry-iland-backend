import { z } from 'zod';

export function validateBody<T extends z.ZodRawShape>(
  shape: T
): z.ZodObject<{ body: z.ZodObject<T> }>;
export function validateBody<T extends z.ZodType>(
  schema: T
): z.ZodObject<{ body: T }>;
export function validateBody(schemaOrShape: z.ZodRawShape | z.ZodType) {
  const bodySchema =
    schemaOrShape instanceof z.ZodType
      ? schemaOrShape
      : z.object(schemaOrShape as z.ZodRawShape);

  return z.object({
    body: bodySchema,
  });
}

export function validateQuery<T extends z.ZodRawShape>(
  shape: T
): z.ZodObject<{ query: z.ZodObject<T> }>;
export function validateQuery<T extends z.ZodType>(
  schema: T
): z.ZodObject<{ query: T }>;
export function validateQuery(schemaOrShape: z.ZodRawShape | z.ZodType) {
  const querySchema =
    schemaOrShape instanceof z.ZodType
      ? schemaOrShape
      : z.object(schemaOrShape as z.ZodRawShape);

  return z.object({
    query: querySchema,
  });
}

export function validateParams<T extends z.ZodRawShape>(
  shape: T
): z.ZodObject<{ params: z.ZodObject<T> }>;
export function validateParams<T extends z.ZodType>(
  schema: T
): z.ZodObject<{ params: T }>;
export function validateParams(schemaOrShape: z.ZodRawShape | z.ZodType) {
  const paramsSchema =
    schemaOrShape instanceof z.ZodType
      ? schemaOrShape
      : z.object(schemaOrShape as z.ZodRawShape);

  return z.object({
    params: paramsSchema,
  });
}

export const zodHelper = {
  validateBody,
  validateQuery,
  validateParams,
};
