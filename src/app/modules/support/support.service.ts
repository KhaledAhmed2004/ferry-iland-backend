import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { PrismaQueryBuilder } from '../../builder';
import { ISupport } from './support.interface';

export const SupportService = {
  createSupport: async (
    userId: string,
    payload: { subject: string; message: string },
  ): Promise<ISupport> => {
    const result = await prisma.supportTicket.create({
      data: {
        subject: payload.subject,
        userId,
        messages: {
          create: {
            senderId: userId,
            message: payload.message,
          },
        },
      },
      include: {
        messages: true,
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!result) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Failed to create support ticket',
      );
    }
    return result;
  },

  getAllSupports: async (query: Record<string, unknown>) => {
    const qb = new PrismaQueryBuilder(
      prisma.supportTicket,
      query,
      'SupportTicket',
    )
      .search(['subject', 'user.name', 'user.email'])
      .filter()
      .dateFilter('createdAt')
      .sort('-createdAt', ['createdAt', 'subject'])
      .paginate()
      .include({
        user: { select: { id: true, name: true, email: true } },
        messages: true,
      });

    return qb.execute();
  },

  getMyTickets: async (userId: string, query: Record<string, unknown>) => {
    const qb = new PrismaQueryBuilder(
      prisma.supportTicket,
      query,
      'SupportTicket',
    )
      .search(['subject'])
      .where({ userId })
      .filter({ customExcludes: ['userId'] })
      .dateFilter('createdAt')
      .sort('-createdAt', ['createdAt', 'subject'])
      .paginate()
      .include({
        messages: true,
      });

    return qb.execute();
  },

  getSupportById: async (id: string) => {
    const result = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        messages: true,
      },
    });

    if (!result) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Support ticket not found');
    }
    return result;
  },

  addMessage: async (ticketId: string, userId: string, message: string) => {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Support ticket not found');
    }

    await prisma.supportMessage.create({
      data: {
        ticketId,
        senderId: userId,
        message,
      },
    });

    return prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        messages: true,
      },
    });
  },

  deleteSupport: async (id: string) => {
    try {
      await prisma.supportTicket.delete({
        where: { id },
      });
      return { deleted: true };
    } catch {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Support ticket not found');
    }
  },
};
