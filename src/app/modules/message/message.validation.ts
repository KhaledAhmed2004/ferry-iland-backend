import { z } from 'zod';

const objectIdValidator = z
  .string({ error: 'Chat ID is required' })
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId format');

const sendMessageZodSchema = z.object({
  params: z.object({
    chatId: objectIdValidator,
  }),
  body: z
    .object({
      text: z.string().max(4000).optional(),
      attachments: z.union([z.string(), z.array(z.string())]).optional(),
      file: z.union([z.string(), z.array(z.string())]).optional(),
      image: z.union([z.string(), z.array(z.string())]).optional(),
      files: z.union([z.string(), z.array(z.string())]).optional(),
      replyTo: z
        .string()
        .optional()
        .refine(val => {
          if (!val) return true;
          return /^[0-9a-fA-F]{24}$/.test(val);
        }, 'Invalid replyTo format'),
    })
    .refine(
      data =>
        data.text ||
        data.attachments ||
        data.file ||
        data.image ||
        data.files,
      {
        message: 'Either text or attachments must be provided',
        path: ['text'],
      },
    ),
});

const getMessagesZodSchema = z.object({
  params: z.object({
    chatId: objectIdValidator,
  }),
  query: z.object({
    limit: z.string().optional(),
    cursor: z.string().optional(),
    searchTerm: z.string().optional(),
  }),
});

export const MessageValidation = { sendMessageZodSchema, getMessagesZodSchema };

