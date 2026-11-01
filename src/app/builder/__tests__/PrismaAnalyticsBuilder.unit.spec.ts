import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaAnalyticsBuilder } from '../PrismaAnalyticsBuilder';

describe('PrismaAnalyticsBuilder Unit Tests', () => {
  let mockModel: any;

  beforeEach(() => {
    mockModel = {
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    };
  });

  describe('1. calculateGrowth()', () => {
    it('calculates positive growth percentage correctly', async () => {
      // total = 100, thisPeriod = 30, lastPeriod = 20 -> growth = +50%
      mockModel.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(20);

      const builder = new PrismaAnalyticsBuilder(mockModel, 'User');
      const result = await builder.calculateGrowth({ period: 'month' });

      expect(result.total).toBe(100);
      expect(result.thisPeriodCount).toBe(30);
      expect(result.lastPeriodCount).toBe(20);
      expect(result.growth).toBe(50);
      expect(result.growthType).toBe('increase');
      expect(result.formattedGrowth).toBe('+50%');
    });

    it('calculates negative growth percentage correctly', async () => {
      // total = 80, thisPeriod = 10, lastPeriod = 20 -> growth = -50%
      mockModel.count
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(20);

      const builder = new PrismaAnalyticsBuilder(mockModel, 'User');
      const result = await builder.calculateGrowth({ period: 'week' });

      expect(result.growth).toBe(-50);
      expect(result.growthType).toBe('decrease');
      expect(result.formattedGrowth).toBe('-50%');
    });

    it('handles zero previous period with non-zero current period as 100% growth', async () => {
      mockModel.count
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(0);

      const builder = new PrismaAnalyticsBuilder(mockModel, 'User');
      const result = await builder.calculateGrowth({ period: 'month' });

      expect(result.growth).toBe(100);
      expect(result.growthType).toBe('increase');
      expect(result.formattedGrowth).toBe('+100%');
    });

    it('handles zero in both periods as no_change (0%)', async () => {
      mockModel.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const builder = new PrismaAnalyticsBuilder(mockModel, 'User');
      const result = await builder.calculateGrowth({ period: 'day' });

      expect(result.growth).toBe(0);
      expect(result.growthType).toBe('no_change');
      expect(result.formattedGrowth).toBe('0%');
    });

    it('supports revenue/sumField aggregation instead of count', async () => {
      mockModel.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 5000 } })
        .mockResolvedValueOnce({ _sum: { amount: 3000 } })
        .mockResolvedValueOnce({ _sum: { amount: 2000 } });

      const builder = new PrismaAnalyticsBuilder(mockModel, 'Payment');
      const result = await builder.calculateGrowth({
        period: 'month',
        sumField: 'amount',
      });

      expect(result.total).toBe(5000);
      expect(result.thisPeriodCount).toBe(3000);
      expect(result.lastPeriodCount).toBe(2000);
      expect(result.growth).toBe(50);
      expect(result.growthType).toBe('increase');
    });

    it('merges chained .where() conditions with options.where', async () => {
      mockModel.count
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(25)
        .mockResolvedValueOnce(25);

      const builder = new PrismaAnalyticsBuilder(mockModel, 'User');
      await builder
        .where({ status: 'ACTIVE' })
        .calculateGrowth({ where: { role: 'OPERATOR' } });

      // Check first call (total count)
      expect(mockModel.count).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', role: 'OPERATOR' },
      });
    });
  });

  describe('2. getTimeTrends()', () => {
    it('generates continuous monthly buckets and fills transactionCount', async () => {
      mockModel.count.mockResolvedValue(10);

      const builder = new PrismaAnalyticsBuilder(mockModel, 'User');
      const trends = await builder.getTimeTrends({
        timeUnit: 'month',
        limit: 4,
        referenceDate: new Date('2026-06-15T00:00:00Z'),
      });

      expect(trends).toHaveLength(4);
      expect(trends[0].transactionCount).toBe(10);
      expect(trends[0].totalRevenue).toBe(0);
      expect(typeof trends[0].label).toBe('string');
    });

    it('supports sumField for financial/volume trends', async () => {
      mockModel.aggregate.mockResolvedValue({
        _sum: { amount: 1500 },
        _count: { _all: 5 },
      });

      const builder = new PrismaAnalyticsBuilder(mockModel, 'Order');
      const trends = await builder.getTimeTrends({
        timeUnit: 'month',
        limit: 3,
        sumField: 'amount',
      });

      expect(trends).toHaveLength(3);
      expect(trends[0].totalRevenue).toBe(1500);
      expect(trends[0].transactionCount).toBe(5);
    });

    it('supports daily time trends', async () => {
      mockModel.count.mockResolvedValue(2);

      const builder = new PrismaAnalyticsBuilder(mockModel, 'Lead');
      const trends = await builder.getTimeTrends({
        timeUnit: 'day',
        limit: 7,
      });

      expect(trends).toHaveLength(7);
      expect(trends[6].transactionCount).toBe(2);
    });
  });

  describe('3. groupBy()', () => {
    it('groups by field and sorts count descending by default', async () => {
      mockModel.groupBy.mockResolvedValueOnce([
        { role: 'USER', _count: { _all: 100 } },
        { role: 'OPERATOR', _count: { _all: 250 } },
        { role: 'ADMIN', _count: { _all: 5 } },
      ]);

      const builder = new PrismaAnalyticsBuilder(mockModel, 'User');
      const res = await builder.groupBy({ by: 'role' });

      expect(res).toHaveLength(3);
      expect(res[0]).toEqual({ key: 'OPERATOR', count: 250 });
      expect(res[1]).toEqual({ key: 'USER', count: 100 });
      expect(res[2]).toEqual({ key: 'ADMIN', count: 5 });
    });

    it('supports limit and sumField on groupBy', async () => {
      mockModel.groupBy.mockResolvedValueOnce([
        { category: 'A', _count: { _all: 10 }, _sum: { amount: 500 } },
        { category: 'B', _count: { _all: 20 }, _sum: { amount: 1200 } },
      ]);

      const builder = new PrismaAnalyticsBuilder(mockModel, 'Item');
      const res = await builder.groupBy({
        by: 'category',
        sumField: 'amount',
        limit: 1,
      });

      expect(res).toHaveLength(1);
      expect(res[0]).toEqual({ key: 'B', count: 20, sum: 1200 });
    });
  });

  describe('4. summary()', () => {
    it('calculates numerical aggregates (sum, avg, min, max)', async () => {
      mockModel.aggregate.mockResolvedValueOnce({
        _count: { _all: 50 },
        _sum: { score: 4500 },
        _avg: { score: 90 },
        _min: { score: 40 },
        _max: { score: 100 },
      });

      const builder = new PrismaAnalyticsBuilder(mockModel, 'Exam');
      const res = await builder.summary({
        sumFields: ['score'],
        avgFields: ['score'],
        minFields: ['score'],
        maxFields: ['score'],
      });

      expect(res.count).toBe(50);
      expect(res.sums.score).toBe(4500);
      expect(res.averages.score).toBe(90);
      expect(res.mins.score).toBe(40);
      expect(res.maxs.score).toBe(100);
    });
  });
});
