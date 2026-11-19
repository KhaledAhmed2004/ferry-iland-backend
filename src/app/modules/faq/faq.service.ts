import { Prisma } from '@prisma/client';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import {
  ICreateFaqPayload,
  IFaqFilterOptions,
  IUpdateFaqPayload,
} from './faq.interface';

const buildWhereClause = (options: IFaqFilterOptions): Prisma.FaqWhereInput => {
  const where: Prisma.FaqWhereInput = {};

  if (typeof options.isPublished === 'boolean') {
    where.isPublished = options.isPublished;
  }

  if (options.category && options.category.toLowerCase() !== 'all') {
    where.category = { equals: options.category, mode: 'insensitive' };
  }

  if (options.search) {
    const searchFilter = {
      contains: options.search,
      mode: 'insensitive' as const,
    };
    where.OR = [
      { question: searchFilter },
      { answer: searchFilter },
      { category: searchFilter },
    ];
  }

  return where;
};

const buildOrderByClause = (
  sortBy?: string,
  sortOrder: 'asc' | 'desc' = 'asc',
): Prisma.FaqOrderByWithRelationInput[] => {
  if (sortBy) {
    return [{ [sortBy]: sortOrder }];
  }
  return [{ order: 'asc' }, { createdAt: 'desc' }];
};

const createFaq = async (payload: ICreateFaqPayload) => {
  let order = payload.order;
  if (order === undefined || order === null) {
    const highest = await prisma.faq.findFirst({
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    order = (highest?.order ?? 0) + 1;
  }

  return prisma.faq.create({
    data: {
      question: payload.question,
      answer: payload.answer,
      category: payload.category || 'Booking',
      isPublished: payload.isPublished ?? true,
      order,
    },
  });
};

const listFaqs = async (options: IFaqFilterOptions) => {
  const isAll = !options.limit || options.limit <= 0;
  const page = options.page ?? 1;
  const limit = isAll ? 0 : options.limit!;
  const skip = isAll ? 0 : (page - 1) * limit;

  const where = buildWhereClause(options);
  const orderBy = buildOrderByClause(options.sortBy, options.sortOrder);

  const [faqs, total, distinctCategories] = await Promise.all([
    prisma.faq.findMany({
      where,
      ...(isAll ? {} : { skip, take: limit }),
      orderBy,
    }),
    prisma.faq.count({ where }),
    prisma.faq.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    }),
  ]);

  const categories = distinctCategories.map(c => c.category).filter(Boolean);

  return {
    meta: {
      page: isAll ? 1 : page,
      limit: isAll ? total : limit,
      total,
      totalPages: isAll ? 1 : Math.ceil(total / limit),
    },
    categories,
    data: faqs,
  };
};

const getFaqById = async (id: string) => {
  const faq = await prisma.faq.findUnique({
    where: { id },
  });

  if (!faq) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'FAQ item not found');
  }

  return faq;
};

const updateFaq = async (id: string, payload: IUpdateFaqPayload) => {
  try {
    return await prisma.faq.update({
      where: { id },
      data: payload,
    });
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'FAQ item not found');
    }
    throw error;
  }
};

const deleteFaq = async (id: string) => {
  try {
    return await prisma.faq.delete({
      where: { id },
    });
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'FAQ item not found');
    }
    throw error;
  }
};

const getPublicFaqs = async (
  options: Pick<IFaqFilterOptions, 'search' | 'category'> = {},
) => {
  return listFaqs({
    ...options,
    isPublished: true,
    limit: 0,
  });
};

export const FaqService = {
  createFaq,
  listFaqs,
  getPublicFaqs,
  getFaqById,
  updateFaq,
  deleteFaq,
};
