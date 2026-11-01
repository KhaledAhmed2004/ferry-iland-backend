import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { PrismaQueryBuilder } from '../../builder';
import { IMessage, ISendMessagePayload } from './message.interface';
import { NotificationBuilder } from '../../../helpers/notification';

const sendMessage = async (
  chatId: string,
  senderId: string,
  payload: ISendMessagePayload,
): Promise<IMessage> => {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      participants: true,
    },
  });

  if (!chat || !chat.participants.some(p => p.userId === senderId)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Chat not found');
  }

  // If replying to a specific message, ensure the target message exists within the same chat
  if (payload.replyTo) {
    const referencedMessage = await prisma.message.findFirst({
      where: {
        id: payload.replyTo,
        chatId,
      },
    });

    if (!referencedMessage) {
      throw new ApiError(
        StatusCodes.NOT_FOUND,
        'Referenced message not found in this chat',
      );
    }
  }

  const rawAttachments =
    payload.attachments ||
    payload.file ||
    payload.image ||
    payload.files;

  const normalizedAttachments: string[] = rawAttachments
    ? Array.isArray(rawAttachments)
      ? rawAttachments
      : [rawAttachments]
    : [];

  const message = await prisma.message.create({
    data: {
      chatId,
      senderId,
      text: payload.text,
      attachments: normalizedAttachments,
      replyToId: payload.replyTo || null,
      readByIds: [senderId],
    },
    include: {
      sender: { select: { id: true, name: true, email: true } },
      replyTo: {
        include: {
          sender: { select: { id: true, name: true } },
        },
      },
    },
  });

  let preview = (payload.text || '').trim().substring(0, 100);
  if (!preview && normalizedAttachments.length > 0) {
    preview = 'Attachment';
  }

  await prisma.chat.update({
    where: { id: chatId },
    data: {
      lastMessage: preview,
      lastMessageAt: message.createdAt,
    },
  });

  const recipient = chat.participants.find(p => p.userId !== senderId);

  if (recipient) {
    const previewText = preview.substring(0, 80);
    new NotificationBuilder()
      .to(recipient.userId)
      .useTemplate('newMessage', {
        senderId: String(senderId),
        senderName: message.sender?.name || 'Someone',
        senderAvatar: '',
        messagePreview: previewText,
        preview: previewText,
        chatId,
        messageId: message.id,
      })
      .viaPush()
      .viaSocket()
      .viaDatabase()
      .send()
      .catch(() => {});

    const io = (global as any).io;
    if (io) {
      io.to(`user::${recipient.userId}`).emit('NEW_MESSAGE', {
        chatId,
        message,
      });
    }
  }

  return message;
};

const getMessages = async (
  chatId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  const isParticipant = await prisma.chatParticipant.findFirst({
    where: { chatId, userId },
  });

  if (!isParticipant) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'You are not a participant of this chat',
    );
  }

  const qb = new PrismaQueryBuilder(prisma.message, query, 'Message')
    .where({ chatId })
    .search(['text'])
    .cursorPaginate('id', 'desc', 20, 100)
    .include({
      sender: { select: { id: true, name: true, email: true } },
      replyTo: {
        include: {
          sender: { select: { id: true, name: true } },
        },
      },
    });

  const result = await qb.executeCursor();

  // Mark unread messages as read
  const unreadIds = result.data
    .filter((m: any) => !m.readByIds?.includes(userId))
    .map((m: any) => m.id);

  if (unreadIds.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Message" SET "readByIds" = array_append("readByIds", $1) WHERE "id" = ANY($2::uuid[])`,
      userId,
      unreadIds,
    ).catch(() => {});
  }

  return {
    cursor: result.cursor,
    data: [...result.data].reverse(),
  };
};

export const MessageService = { sendMessage, getMessages };
