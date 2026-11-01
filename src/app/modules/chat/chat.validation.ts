import { z } from 'zod';

const createChatZodSchema = z.object({
  body: z.object({
    participantId: z
      .string({ error: 'Participant ID is required' })
      .min(1, { message: 'Participant ID is required' }),
    itemId: z.string().min(1).optional(),
    jobId: z.string().min(1).optional(),
    supportId: z.string().min(1).optional(),
  }),
});

const getChatByIdZodSchema = z.object({
  params: z.object({
    chatId: z
      .string({ error: 'Chat ID is required' })
      .min(1, { message: 'Chat ID is required' }),
  }),
});

const deleteChatZodSchema = z.object({
  params: z.object({
    chatId: z
      .string({ error: 'Chat ID is required' })
      .min(1, { message: 'Chat ID is required' }),
  }),
});

const getMyChatsQueryZodSchema = z.object({
  query: z
    .object({
      searchTerm: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    })
    .optional(),
});

export const ChatValidation = {
  createChatZodSchema,
  getChatByIdZodSchema,
  deleteChatZodSchema,
  getMyChatsQueryZodSchema,
};

