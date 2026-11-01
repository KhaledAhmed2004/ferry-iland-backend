import { Chat, ChatParticipant, User } from '@prisma/client';

export type IChat = Chat & {
  participants?: (ChatParticipant & { user?: Partial<User> })[];
};

export type IChatParticipant = {
  id: string;
  name: string;
  email?: string;
  profilePicture?: string;
};

export type IChatWithUnread = Chat & {
  participants?: any[];
  unreadCount: number;
  isRead: boolean;
};
