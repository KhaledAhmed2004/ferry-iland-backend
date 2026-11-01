import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { IChat, IChatWithUnread } from './chat.interface';

const getOrCreateChat = async (
  requesterId: string,
  participantId: string,
  _context?: { itemId?: string; jobId?: string; supportId?: string },
): Promise<IChat> => {
  if (requesterId === participantId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You cannot start a chat with yourself',
    );
  }

  const sortedParticipants = [requesterId, participantId].sort();
  const conversationKey = sortedParticipants.join('_');

  let chat = await prisma.chat.findUnique({
    where: { conversationKey },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!chat) {
    chat = await prisma.chat.create({
      data: {
        conversationKey,
        participants: {
          create: [{ userId: requesterId }, { userId: participantId }],
        },
      },
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  return chat as any;
};

const getMyChats = async (
  userId: string,
  query?: Record<string, unknown>,
): Promise<IChatWithUnread[]> => {
  const rawSearch = query?.searchTerm;
  const searchTerm =
    typeof rawSearch === 'string' ? rawSearch.trim() : undefined;

  const chats = await prisma.chat.findMany({
    where: {
      participants: {
        some: { userId },
      },
      ...(searchTerm
        ? {
            OR: [
              {
                lastMessage: {
                  contains: searchTerm,
                  mode: 'insensitive',
                },
              },
              {
                participants: {
                  some: {
                    user: {
                      name: {
                        contains: searchTerm,
                        mode: 'insensitive',
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return chats.map(chat => {
    return {
      ...chat,
      unreadCount: 0,
      isRead: true,
    } as unknown as IChatWithUnread;
  });
};

const getChatById = async (
  chatId: string,
  userId: string,
): Promise<IChatWithUnread> => {
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      participants: {
        some: { userId },
      },
    },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!chat) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Chat not found');
  }

  return {
    ...chat,
    unreadCount: 0,
    isRead: true,
  } as unknown as IChatWithUnread;
};

const deleteChatFromDB = async (chatId: string, userId: string) => {
  const isParticipant = await prisma.chatParticipant.findFirst({
    where: {
      chatId,
      userId,
    },
  });

  if (!isParticipant) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Chat not found');
  }

  await prisma.chat.delete({
    where: { id: chatId },
  });

  return { deleted: true, id: chatId };
};

export const ChatService = {
  getOrCreateChat,
  getMyChats,
  getChatById,
  deleteChatFromDB,
};
