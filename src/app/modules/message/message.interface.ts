import { Message, User } from '@prisma/client';

export type IMessage = Message & {
  sender?: Partial<User>;
  replyTo?: (Message & { sender?: Partial<User> }) | null;
};

export type ISendMessagePayload = {
  text?: string;
  attachments?: string | string[];
  file?: string | string[];
  image?: string | string[];
  files?: string | string[];
  replyTo?: string;
};
