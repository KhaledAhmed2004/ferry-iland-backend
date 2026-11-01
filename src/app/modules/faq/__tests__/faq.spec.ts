import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { FaqService } from '../faq.service';
import { prisma } from '../../../../shared/prisma';
import ApiError from '../../../../errors/ApiError';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    faq: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe('FaqService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createFaq', () => {
    it('creates a new FAQ item successfully', async () => {
      const payload = {
        question: 'How do I cancel a ticket?',
        answer: 'You can cancel through Manage Booking.',
        category: 'Cancellation & Refund',
        isPublished: true,
        order: 1,
      };

      vi.mocked(prisma.faq.create).mockResolvedValue({
        id: 'faq-1',
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await FaqService.createFaq(payload);

      expect(result).toMatchObject({
        id: 'faq-1',
        question: payload.question,
      });
      expect(prisma.faq.create).toHaveBeenCalledWith({
        data: payload,
      });
    });

    it('assigns incremented order if not provided', async () => {
      const payload = {
        question: 'What payment methods?',
        answer: 'Visa and Mastercard.',
      };

      vi.mocked(prisma.faq.findFirst).mockResolvedValue({
        order: 5,
      } as any);

      vi.mocked(prisma.faq.create).mockResolvedValue({
        id: 'faq-2',
        question: payload.question,
        answer: payload.answer,
        category: 'Booking',
        isPublished: true,
        order: 6,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await FaqService.createFaq(payload);

      expect(result.order).toBe(6);
      expect(prisma.faq.create).toHaveBeenCalledWith({
        data: {
          question: payload.question,
          answer: payload.answer,
          category: 'Booking',
          isPublished: true,
          order: 6,
        },
      });
    });
  });

  describe('listFaqs', () => {
    it('returns paginated FAQs and distinct categories', async () => {
      vi.mocked(prisma.faq.count)
        .mockResolvedValueOnce(8) // ensureSeeded check
        .mockResolvedValueOnce(2); // query count

      const mockFaqs = [
        {
          id: 'faq-1',
          question: 'Q1',
          answer: 'A1',
          category: 'Booking',
          isPublished: true,
          order: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'faq-2',
          question: 'Q2',
          answer: 'A2',
          category: 'Payment',
          isPublished: true,
          order: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(prisma.faq.findMany)
        .mockResolvedValueOnce(mockFaqs as any)
        .mockResolvedValueOnce([
          { category: 'Booking' },
          { category: 'Payment' },
        ] as any);

      const result = await FaqService.listFaqs({ page: 1, limit: 10 });

      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
      expect(result.data).toHaveLength(2);
      expect(result.categories).toEqual(['Booking', 'Payment']);
    });
  });

  describe('getFaqById', () => {
    it('returns FAQ item when found', async () => {
      const mockItem = {
        id: 'faq-1',
        question: 'Q1',
        answer: 'A1',
        category: 'Booking',
        isPublished: true,
        order: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.faq.findUnique).mockResolvedValue(mockItem as any);

      const result = await FaqService.getFaqById('faq-1');
      expect(result).toEqual(mockItem);
    });

    it('throws 404 ApiError when FAQ item not found', async () => {
      vi.mocked(prisma.faq.findUnique).mockResolvedValue(null);

      await expect(FaqService.getFaqById('non-existent')).rejects.toThrow(ApiError);
    });
  });

  describe('updateFaq', () => {
    it('updates FAQ item successfully', async () => {
      const existing = {
        id: 'faq-1',
        question: 'Old Q',
        answer: 'Old A',
        category: 'Booking',
        isPublished: true,
        order: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.faq.findUnique).mockResolvedValue(existing as any);
      vi.mocked(prisma.faq.update).mockResolvedValue({
        ...existing,
        question: 'New Q',
      } as any);

      const result = await FaqService.updateFaq('faq-1', { question: 'New Q' });
      expect(result.question).toBe('New Q');
    });
  });

  describe('deleteFaq', () => {
    it('deletes FAQ item successfully', async () => {
      const existing = {
        id: 'faq-1',
        question: 'Q',
        answer: 'A',
        category: 'Booking',
        isPublished: true,
        order: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.faq.findUnique).mockResolvedValue(existing as any);
      vi.mocked(prisma.faq.delete).mockResolvedValue(existing as any);

      const result = await FaqService.deleteFaq('faq-1');
      expect(result).toEqual(existing);
      expect(prisma.faq.delete).toHaveBeenCalledWith({ where: { id: 'faq-1' } });
    });
  });

  describe('bulkUpdatePublish', () => {
    it('updates publication status for multiple FAQs', async () => {
      vi.mocked(prisma.faq.updateMany).mockResolvedValue({ count: 3 });

      const result = await FaqService.bulkUpdatePublish(['faq-1', 'faq-2', 'faq-3'], false);
      expect(result.count).toBe(3);
      expect(prisma.faq.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['faq-1', 'faq-2', 'faq-3'] } },
        data: { isPublished: false },
      });
    });
  });

  describe('bulkUpdateCategory', () => {
    it('updates category for multiple FAQs', async () => {
      vi.mocked(prisma.faq.updateMany).mockResolvedValue({ count: 2 });

      const result = await FaqService.bulkUpdateCategory(['faq-1', 'faq-2'], 'Travel Information');
      expect(result.count).toBe(2);
      expect(prisma.faq.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['faq-1', 'faq-2'] } },
        data: { category: 'Travel Information' },
      });
    });
  });

  describe('bulkDelete', () => {
    it('deletes multiple FAQs', async () => {
      vi.mocked(prisma.faq.deleteMany).mockResolvedValue({ count: 2 });

      const result = await FaqService.bulkDelete(['faq-1', 'faq-2']);
      expect(result.count).toBe(2);
      expect(prisma.faq.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['faq-1', 'faq-2'] } },
      });
    });
  });

});
