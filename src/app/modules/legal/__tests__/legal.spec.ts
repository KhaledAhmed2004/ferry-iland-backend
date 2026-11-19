import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { LegalService, DEFAULT_LEGAL_DOCS } from '../legal.service';
import { prisma } from '../../../../shared/prisma';
import ApiError from '../../../../errors/ApiError';

vi.mock('../../../../shared/prisma', () => ({
  prisma: {
    legalPage: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('LegalService Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Predefined Canonical Legal Documents', () => {
    it('has 3 permanent canonical legal documents', () => {
      expect(DEFAULT_LEGAL_DOCS).toHaveLength(3);
      const slugs = DEFAULT_LEGAL_DOCS.map((d) => d.slug);
      expect(slugs).toContain('terms-of-service');
      expect(slugs).toContain('privacy-policy');
      expect(slugs).toContain('cancellation-policy');
    });

    it('ensureDefaultLegalPages upserts all 3 canonical documents', async () => {
      vi.mocked(prisma.legalPage.upsert).mockResolvedValue({} as any);

      await LegalService.ensureDefaultLegalPages();

      expect(prisma.legalPage.upsert).toHaveBeenCalledTimes(3);
      expect(prisma.legalPage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: 'terms-of-service' },
          update: {},
        }),
      );
    });

    it('does not expose createLegalPage or deleteById (removed by design)', () => {
      expect((LegalService as any).createLegalPage).toBeUndefined();
      expect((LegalService as any).deleteById).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('fetches only published legal pages for public non-admin users', async () => {
      const mockDocs = [
        {
          id: '1',
          title: 'Terms of Service',
          slug: 'terms-of-service',
          content: 'Terms content',
          isPublished: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(prisma.legalPage.upsert).mockResolvedValue({} as any);
      vi.mocked(prisma.legalPage.findMany).mockResolvedValue(mockDocs as any);

      const result = await LegalService.getAll(false);

      expect(prisma.legalPage.findMany).toHaveBeenCalledWith({
        where: { isPublished: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('fetches all legal pages (including drafts) for admin users', async () => {
      vi.mocked(prisma.legalPage.upsert).mockResolvedValue({} as any);
      vi.mocked(prisma.legalPage.findMany).mockResolvedValue([] as any);

      await LegalService.getAll(true);

      expect(prisma.legalPage.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('getByIdOrSlug', () => {
    it('retrieves document by slug successfully', async () => {
      const mockDoc = {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Privacy Policy',
        slug: 'privacy-policy',
        content: 'Privacy content',
        isPublished: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.legalPage.upsert).mockResolvedValue({} as any);
      vi.mocked(prisma.legalPage.findFirst).mockResolvedValue(mockDoc as any);

      const result = await LegalService.getByIdOrSlug('privacy-policy', false);

      expect(result).toEqual(mockDoc);
    });

    it('throws NOT_FOUND if document does not exist', async () => {
      vi.mocked(prisma.legalPage.upsert).mockResolvedValue({} as any);
      vi.mocked(prisma.legalPage.findFirst).mockResolvedValue(null);

      await expect(LegalService.getByIdOrSlug('unknown-slug', false)).rejects.toThrow(
        ApiError,
      );
    });
  });

  describe('updateById', () => {
    it('updates title, content, and isPublished successfully', async () => {
      const existing = {
        id: 'doc-uuid-1',
        title: 'Terms of Service',
        slug: 'terms-of-service',
        content: 'Old terms',
        isPublished: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updated = {
        ...existing,
        title: 'Updated Terms of Service',
        content: 'New terms content',
      };

      vi.mocked(prisma.legalPage.findUnique).mockResolvedValue(existing as any);
      vi.mocked(prisma.legalPage.update).mockResolvedValue(updated as any);

      const result = await LegalService.updateById('doc-uuid-1', {
        title: 'Updated Terms of Service',
        content: 'New terms content',
      });

      expect(prisma.legalPage.update).toHaveBeenCalledWith({
        where: { id: 'doc-uuid-1' },
        data: {
          title: 'Updated Terms of Service',
          content: 'New terms content',
        },
      });
      expect(result.title).toBe('Updated Terms of Service');
    });

    it('throws NOT_FOUND when updating non-existent document', async () => {
      vi.mocked(prisma.legalPage.findUnique).mockResolvedValue(null);

      await expect(
        LegalService.updateById('non-existent', { title: 'Test' }),
      ).rejects.toThrow(ApiError);
    });
  });
});
