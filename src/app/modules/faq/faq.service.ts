import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import {
  ICreateFaqPayload,
  IFaqFilterOptions,
  IUpdateFaqPayload,
} from './faq.interface';

const DEFAULT_FAQS = [
  {
    question: 'How do I book a ferry ticket?',
    category: 'Booking',
    answer:
      'You can search your departure island, destination, date, and passenger count directly on our home or routes page. Select your preferred speedboat or catamaran trip, fill in your passenger details, and pay securely online to get your instant QR e-ticket.',
    order: 1,
    isPublished: true,
  },
  {
    question: 'How can I change my booking?',
    category: 'Booking',
    answer:
      "You can modify your travel date or time up to 2 hours before departure directly through your 'Manage Booking' portal or by contacting our 24/7 passenger support team.",
    order: 2,
    isPublished: true,
  },
  {
    question: 'What is the cancellation policy?',
    category: 'Cancellation & Refund',
    answer:
      'Cancellations made more than 24 hours prior to departure are eligible for a 100% full refund. Cancellations between 2 and 24 hours receive an 80% refund. If a trip is cancelled by the operator due to sea warnings or rough weather, you receive an immediate 100% refund.',
    order: 3,
    isPublished: true,
  },
  {
    question: 'How do I request a refund?',
    category: 'Cancellation & Refund',
    answer:
      "Go to 'Manage Booking' with your booking reference (e.g. FRY24821) and email, click 'Cancel Trip', and select 'Request Refund'. Refunds are credited back to your original payment method within 3-5 business days.",
    order: 4,
    isPublished: true,
  },
  {
    question: 'Which payment methods do you accept?',
    category: 'Payment',
    answer:
      'We accept all major Visa, Mastercard, American Express, Apple Pay, Google Pay, and localized Maldivian Bank debit cards through our secure payment gateway.',
    order: 5,
    isPublished: true,
  },
  {
    question: 'What should I do if my payment failed?',
    category: 'Payment',
    answer:
      'Ensure your card details and 3D Secure OTP are entered accurately. If the issue persists, try an alternate card or contact our phone support at +960 333 1234.',
    order: 6,
    isPublished: true,
  },
  {
    question: 'Can I travel with a vehicle or bicycle?',
    category: 'Travel Information',
    answer:
      'Speedboats can accommodate foldable bicycles and surfboards if declared in advance. Full-sized vehicles are only accommodated on large public MTCC Ro-Ro ferries between Malé and select regional hub islands.',
    order: 7,
    isPublished: true,
  },
  {
    question: 'What time should I arrive at the terminal?',
    category: 'Travel Information',
    answer:
      'We strongly recommend arriving at your designated pier or harbor terminal at least 20-30 minutes before your scheduled departure time to ensure smooth luggage tagging and boarding.',
    order: 8,
    isPublished: true,
  },
];

const ensureSeeded = async () => {
  const count = await prisma.faq.count();
  if (count === 0) {
    for (const item of DEFAULT_FAQS) {
      await prisma.faq.create({
        data: item,
      });
    }
  }
};

const createFaq = async (payload: ICreateFaqPayload) => {
  let order = payload.order;
  if (order === undefined || order === 0) {
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
  await ensureSeeded();

  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const skip = (page - 1) * limit;

  const whereClause: Record<string, any> = {};

  if (typeof options.isPublished === 'boolean') {
    whereClause.isPublished = options.isPublished;
  }

  if (options.category && options.category.toLowerCase() !== 'all') {
    whereClause.category = { equals: options.category, mode: 'insensitive' };
  }

  if (options.search) {
    whereClause.OR = [
      { question: { contains: options.search, mode: 'insensitive' } },
      { answer: { contains: options.search, mode: 'insensitive' } },
      { category: { contains: options.search, mode: 'insensitive' } },
    ];
  }

  const orderByClause: Record<string, 'asc' | 'desc'>[] = [];
  if (options.sortBy) {
    orderByClause.push({ [options.sortBy]: options.sortOrder || 'asc' });
  } else {
    orderByClause.push({ order: 'asc' }, { createdAt: 'desc' });
  }

  const takeClause = limit > 0 ? { skip, take: limit } : {};

  const [faqs, total, distinctCategoriesRaw] = await Promise.all([
    prisma.faq.findMany({
      where: whereClause,
      ...(limit > 0 ? { skip, take: limit } : {}),
      orderBy: orderByClause,
    } as any),
    prisma.faq.count({ where: whereClause }),
    prisma.faq.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    }),
  ]);

  const categories = distinctCategoriesRaw
    .map(c => c.category)
    .filter(Boolean);

  return {
    meta: {
      page: limit > 0 ? page : 1,
      limit: limit > 0 ? limit : total,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 1,
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
  await getFaqById(id);

  return prisma.faq.update({
    where: { id },
    data: {
      ...(payload.question !== undefined && { question: payload.question }),
      ...(payload.answer !== undefined && { answer: payload.answer }),
      ...(payload.category !== undefined && { category: payload.category }),
      ...(payload.isPublished !== undefined && { isPublished: payload.isPublished }),
      ...(payload.order !== undefined && { order: payload.order }),
    },
  });
};

const deleteFaq = async (id: string) => {
  await getFaqById(id);

  return prisma.faq.delete({
    where: { id },
  });
};

const getPublicFaqs = async (options: Pick<IFaqFilterOptions, 'search' | 'category'>) => {
  return listFaqs({
    ...options,
    isPublished: true,
    limit: 0,
  });
};


const bulkUpdatePublish = async (ids: string[], isPublished: boolean) => {
  return prisma.faq.updateMany({
    where: { id: { in: ids } },
    data: { isPublished },
  });
};

const bulkUpdateCategory = async (ids: string[], category: string) => {
  return prisma.faq.updateMany({
    where: { id: { in: ids } },
    data: { category },
  });
};

const bulkDelete = async (ids: string[]) => {
  return prisma.faq.deleteMany({
    where: { id: { in: ids } },
  });
};

export const FaqService = {
  createFaq,
  listFaqs,
  getPublicFaqs,
  getFaqById,
  updateFaq,
  deleteFaq,
  ensureSeeded,
  bulkUpdatePublish,
  bulkUpdateCategory,
  bulkDelete,
};
