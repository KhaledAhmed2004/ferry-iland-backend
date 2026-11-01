import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaQueryBuilder } from '../PrismaQueryBuilder';
import ApiError from '../../../errors/ApiError';

describe('PrismaQueryBuilder Unit Tests', () => {
  let mockModel: any;
  let findManySpy: any;
  let countSpy: any;

  beforeEach(() => {
    findManySpy = vi.fn(async () => [
      { id: '1', name: 'John Doe', email: 'john@example.com' },
      { id: '2', name: 'Jane Doe', email: 'jane@example.com' },
    ]);
    countSpy = vi.fn(async () => 25);

    mockModel = {
      findMany: findManySpy,
      count: countSpy,
    };
  });

  describe('Search functionality', () => {
    it('should build case-insensitive substring search across direct fields', () => {
      const qb = new PrismaQueryBuilder(mockModel, { searchTerm: 'john' });
      qb.search(['name', 'email']);

      const where = qb.getWhere();
      expect(where.AND).toEqual([
        {
          OR: [
            { name: { contains: 'john', mode: 'insensitive' } },
            { email: { contains: 'john', mode: 'insensitive' } },
          ],
        },
      ]);
    });

    it('should handle nested relation dot-notated fields', () => {
      const qb = new PrismaQueryBuilder(mockModel, { searchTerm: 'tech' });
      qb.search(['name', 'operatorProfile.companyName']);

      const where = qb.getWhere();
      expect(where.AND).toEqual([
        {
          OR: [
            { name: { contains: 'tech', mode: 'insensitive' } },
            {
              operatorProfile: {
                companyName: { contains: 'tech', mode: 'insensitive' },
              },
            },
          ],
        },
      ]);
    });

    it('should truncate searchTerm if longer than maxSearchLength', () => {
      const longTerm = 'a'.repeat(300);
      const qb = new PrismaQueryBuilder(mockModel, { searchTerm: longTerm });
      qb.search(['name'], 10);

      const where = qb.getWhere();
      expect(where.AND[0].OR[0].name.contains).toBe('a'.repeat(10));
    });

    it('should not add search condition if searchTerm is absent', () => {
      const qb = new PrismaQueryBuilder(mockModel, {});
      qb.search(['name', 'email']);

      expect(qb.getWhere().AND).toBeUndefined();
    });
  });

  describe('Filter functionality', () => {
    it('should exclude standard framework parameters and dangerous keys', () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        page: '2',
        limit: '15',
        sort: '-createdAt',
        searchTerm: 'test',
        role: 'ADMIN',
        isActive: 'true',
        __proto__: { hacked: true },
        $where: 'malicious',
      });

      qb.filter();

      const where = qb.getWhere();
      expect(where.page).toBeUndefined();
      expect(where.limit).toBeUndefined();
      expect(where.sort).toBeUndefined();
      expect(where.searchTerm).toBeUndefined();
      expect(where.role).toBe('ADMIN');
      expect(where.isActive).toBe(true);
      expect((where as any).__proto__?.hacked).toBeUndefined();
      expect(where.$where).toBeUndefined();
    });

    it('should respect customExcludes', () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        status: 'PENDING',
        keepMe: 'yes',
      });

      qb.filter({ customExcludes: ['status'] });

      const where = qb.getWhere();
      expect(where.status).toBeUndefined();
      expect(where.keepMe).toBe('yes');
    });
  });

  describe('Range filter functionality', () => {
    it('should build gte and lte criteria for numeric ranges', () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        minPrice: '100',
        maxPrice: '500',
      });

      qb.range('price');

      const where = qb.getWhere();
      expect(where.price).toEqual({ gte: 100, lte: 500 });
    });

    it('should support custom min/max query keys', () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        lowestSalary: '2000',
        highestSalary: '5000',
      });

      qb.range('salary', 'lowestSalary', 'highestSalary');

      const where = qb.getWhere();
      expect(where.salary).toEqual({ gte: 2000, lte: 5000 });
    });
  });

  describe('Category filter', () => {
    it('should split comma-separated values into Prisma in clause', () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        category: 'electronics,books',
      });

      qb.categoryFilter('category');

      const where = qb.getWhere();
      expect(where.category).toEqual({ in: ['electronics', 'books'] });
    });
  });

  describe('Date filter functionality', () => {
    it('should build date range for recently filter', () => {
      const qb = new PrismaQueryBuilder(mockModel, { timeFilter: 'recently' });
      qb.dateFilter('createdAt');

      const where = qb.getWhere();
      expect(where.createdAt.gte).toBeInstanceOf(Date);
      expect(where.createdAt.lte).toBeInstanceOf(Date);
    });

    it('should throw error on invalid custom date format', () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        timeFilter: 'custom',
        start: 'invalid-date',
        end: '2026-10-14',
      });

      expect(() => qb.dateFilter()).toThrow(ApiError);
    });

    it('should throw error when start date is after end date', () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        timeFilter: 'custom',
        start: '2026-10-15',
        end: '2026-10-14',
      });

      expect(() => qb.dateFilter()).toThrow(ApiError);
    });
  });

  describe('Location filter', () => {
    it('should calculate bounding box on valid coordinates', () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        latitude: '23.8103',
        longitude: '90.4125',
        distance: '10',
      });

      qb.locationFilter('latitude', 'longitude');

      const where = qb.getWhere();
      expect(where.latitude.gte).toBeDefined();
      expect(where.latitude.lte).toBeDefined();
      expect(where.longitude.gte).toBeDefined();
      expect(where.longitude.lte).toBeDefined();
    });

    it('should throw error on invalid latitude', () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        latitude: '120',
        longitude: '90',
        distance: '5',
      });

      expect(() => qb.locationFilter()).toThrow(ApiError);
    });
  });

  describe('Sorting functionality', () => {
    it('should parse comma-separated sort strings with prefixes', () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        sort: '-createdAt,name',
      });

      qb.sort();

      expect(qb.getOrderBy()).toEqual([
        { createdAt: 'desc' },
        { name: 'asc' },
      ]);
    });

    it('should enforce allowedFields whitelist', () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        sort: '-createdAt,secretField',
      });

      qb.sort('-createdAt', ['createdAt', 'name']);

      expect(qb.getOrderBy()).toEqual([{ createdAt: 'desc' }]);
    });
  });

  describe('Pagination & Execution', () => {
    it('should paginate and execute findMany and count concurrently', async () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        page: '2',
        limit: '10',
      });

      const result = await qb
        .where({ deletedAt: null })
        .include({ operatorProfile: true })
        .sort('-createdAt')
        .execute();

      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          skip: 10,
          take: 10,
          orderBy: [{ createdAt: 'desc' }],
          include: { operatorProfile: true },
        }),
      );

      expect(countSpy).toHaveBeenCalledWith({
        where: { deletedAt: null },
      });

      expect(result).toEqual({
        data: [
          { id: '1', name: 'John Doe', email: 'john@example.com' },
          { id: '2', name: 'Jane Doe', email: 'jane@example.com' },
        ],
        pagination: {
          total: 25,
          limit: 10,
          page: 2,
          totalPage: 3,
        },
      });
    });

    it('should return pagination info directly', async () => {
      const qb = new PrismaQueryBuilder(mockModel, {
        page: '1',
        limit: '5',
      });

      const info = await qb.getPaginationInfo();

      expect(countSpy).toHaveBeenCalled();
      expect(info).toEqual({
        total: 25,
        limit: 5,
        page: 1,
        totalPage: 5,
      });
    });
  });

  describe('Cursor Pagination & Execution', () => {
    it('should configure cursor pagination and execute lookahead query', async () => {
      findManySpy.mockResolvedValueOnce([
        { id: '1', text: 'Message 1' },
        { id: '2', text: 'Message 2' },
        { id: '3', text: 'Message 3' }, // Extra item indicating hasMore
      ]);

      const qb = new PrismaQueryBuilder(mockModel, { limit: '2' });
      qb.cursorPaginate('id', 'desc', 2, 10);

      const result = await qb.executeCursor();

      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 3, // 2 + 1 lookahead
          orderBy: [{ id: 'desc' }],
        }),
      );

      expect(result.data).toHaveLength(2);
      expect(result.cursor.hasMore).toBe(true);
      expect(result.cursor.nextCursor).toBeDefined();

      // Verify nextCursor decodes properly
      const decoded = JSON.parse(
        Buffer.from(result.cursor.nextCursor!, 'base64url').toString('utf8'),
      );
      expect(decoded.id).toBe('2');
    });

    it('should decode cursor token and apply comparison filter', async () => {
      const token = Buffer.from(JSON.stringify({ id: '10' })).toString('base64url');

      const qb = new PrismaQueryBuilder(mockModel, { cursor: token, limit: '2' });
      qb.cursorPaginate('id', 'asc');

      await qb.executeCursor();

      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { gt: '10' },
          },
        }),
      );
    });

    it('should throw error on corrupted cursor token', async () => {
      const qb = new PrismaQueryBuilder(mockModel, { cursor: 'invalid-not-base64-json' });
      qb.cursorPaginate();

      await expect(qb.executeCursor()).rejects.toThrow(ApiError);
    });

    it('should set hasMore to false when result length is within limit', async () => {
      findManySpy.mockResolvedValueOnce([
        { id: '1', text: 'Only Message' },
      ]);

      const qb = new PrismaQueryBuilder(mockModel, { limit: '5' });
      qb.cursorPaginate('id', 'desc');

      const result = await qb.executeCursor();

      expect(result.data).toHaveLength(1);
      expect(result.cursor.hasMore).toBe(false);
      expect(result.cursor.nextCursor).toBeNull();
    });
  });
});

