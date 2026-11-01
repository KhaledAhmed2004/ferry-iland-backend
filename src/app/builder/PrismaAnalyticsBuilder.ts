import { recordDbQuery } from '../logging/requestContext';

export type PeriodType = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type GrowthType = 'increase' | 'decrease' | 'no_change';

export type IStatistic = {
  total: number;
  thisPeriodCount: number;
  lastPeriodCount: number;
  growth: number;
  formattedGrowth?: string;
  growthType: GrowthType;
};

export type ITrendPoint = {
  label: string;
  totalRevenue: number;
  transactionCount: number;
};

export type IPeriodDates = {
  currentPeriodStartDate: Date;
  previousPeriodStartDate: Date;
  previousPeriodEndDate: Date;
  startThis: Date;
  startLast: Date;
  endLast: Date;
};

export const getPeriodDates = (
  period: PeriodType = 'month',
  referenceDate = new Date(),
): IPeriodDates => {
  const referenceDateTime = new Date(referenceDate);
  let currentPeriodStartDate: Date;
  let previousPeriodStartDate: Date;
  let previousPeriodEndDate: Date;

  switch (period) {
    case 'day': {
      currentPeriodStartDate = new Date(
        referenceDateTime.getFullYear(),
        referenceDateTime.getMonth(),
        referenceDateTime.getDate(),
        0,
        0,
        0,
        0,
      );

      previousPeriodStartDate = new Date(currentPeriodStartDate);
      previousPeriodStartDate.setDate(currentPeriodStartDate.getDate() - 1);

      previousPeriodEndDate = new Date(currentPeriodStartDate);
      previousPeriodEndDate.setMilliseconds(-1);
      break;
    }

    case 'week': {
      const dayOfWeekIndex = referenceDateTime.getDay();
      currentPeriodStartDate = new Date(
        referenceDateTime.getFullYear(),
        referenceDateTime.getMonth(),
        referenceDateTime.getDate() - dayOfWeekIndex,
        0,
        0,
        0,
        0,
      );

      previousPeriodStartDate = new Date(currentPeriodStartDate);
      previousPeriodStartDate.setDate(currentPeriodStartDate.getDate() - 7);

      previousPeriodEndDate = new Date(currentPeriodStartDate);
      previousPeriodEndDate.setMilliseconds(-1);
      break;
    }

    case 'month': {
      currentPeriodStartDate = new Date(
        referenceDateTime.getFullYear(),
        referenceDateTime.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );
      previousPeriodStartDate = new Date(
        referenceDateTime.getFullYear(),
        referenceDateTime.getMonth() - 1,
        1,
        0,
        0,
        0,
        0,
      );

      previousPeriodEndDate = new Date(currentPeriodStartDate);
      previousPeriodEndDate.setMilliseconds(-1);
      break;
    }

    case 'quarter': {
      const currentQuarterIndex = Math.floor(referenceDateTime.getMonth() / 3);
      currentPeriodStartDate = new Date(
        referenceDateTime.getFullYear(),
        currentQuarterIndex * 3,
        1,
        0,
        0,
        0,
        0,
      );

      const previousQuarterStartMonthIndex = (currentQuarterIndex - 1) * 3;
      previousPeriodStartDate = new Date(
        referenceDateTime.getFullYear(),
        previousQuarterStartMonthIndex,
        1,
        0,
        0,
        0,
        0,
      );

      previousPeriodEndDate = new Date(currentPeriodStartDate);
      previousPeriodEndDate.setMilliseconds(-1);
      break;
    }

    case 'year': {
      currentPeriodStartDate = new Date(
        referenceDateTime.getFullYear(),
        0,
        1,
        0,
        0,
        0,
        0,
      );
      previousPeriodStartDate = new Date(
        referenceDateTime.getFullYear() - 1,
        0,
        1,
        0,
        0,
        0,
        0,
      );

      previousPeriodEndDate = new Date(currentPeriodStartDate);
      previousPeriodEndDate.setMilliseconds(-1);
      break;
    }

    default:
      throw new Error(`Unsupported period: ${period}`);
  }

  return {
    currentPeriodStartDate,
    previousPeriodStartDate,
    previousPeriodEndDate,
    startThis: currentPeriodStartDate,
    startLast: previousPeriodStartDate,
    endLast: previousPeriodEndDate,
  };
};

export interface IAnalyticsGrowthOptions {
  period?: PeriodType;
  dateField?: string;
  sumField?: string;
  where?: Record<string, any>;
}

export interface IAnalyticsTimeTrendsOptions {
  timeUnit?: 'day' | 'week' | 'month' | 'year';
  limit?: number;
  dateField?: string;
  sumField?: string;
  where?: Record<string, any>;
  referenceDate?: Date;
}

export interface IAnalyticsGroupByOptions {
  by: string;
  where?: Record<string, any>;
  sumField?: string;
  orderBy?: 'count_desc' | 'count_asc' | 'key_asc';
  limit?: number;
}

export interface IAnalyticsSummaryOptions {
  where?: Record<string, any>;
  sumFields?: string[];
  avgFields?: string[];
  minFields?: string[];
  maxFields?: string[];
}

export class PrismaAnalyticsBuilder {
  private prismaModelDelegate: any;
  private databaseModelName: string;
  private persistentDefaultFilter: Record<string, any> = {};

  constructor(
    prismaModelDelegate: any,
    databaseModelName: string = 'UnknownModel',
  ) {
    this.prismaModelDelegate = prismaModelDelegate;
    this.databaseModelName = databaseModelName;
  }

  where(filterConditions: Record<string, any>): this {
    this.persistentDefaultFilter = {
      ...this.persistentDefaultFilter,
      ...filterConditions,
    };
    return this;
  }

  async calculateGrowth(
    options: IAnalyticsGrowthOptions = {},
  ): Promise<IStatistic> {
    const queryExecutionStartTime = Date.now();
    const period = options.period || 'month';
    const timestampFieldName = options.dateField || 'createdAt';
    const numericFieldToSum = options.sumField;
    const combinedWhereFilter = {
      ...this.persistentDefaultFilter,
      ...(options.where || {}),
    };

    const {
      currentPeriodStartDate,
      previousPeriodStartDate,
      previousPeriodEndDate,
    } = getPeriodDates(period);

    const currentPeriodWhereFilter = {
      ...combinedWhereFilter,
      [timestampFieldName]: { gte: currentPeriodStartDate },
    };

    const previousPeriodWhereFilter = {
      ...combinedWhereFilter,
      [timestampFieldName]: {
        gte: previousPeriodStartDate,
        lte: previousPeriodEndDate,
      },
    };

    let total = 0;
    let thisPeriodCount = 0;
    let lastPeriodCount = 0;

    if (numericFieldToSum) {
      const [
        totalAggregatedResult,
        currentPeriodAggregatedResult,
        previousPeriodAggregatedResult,
      ] = await Promise.all([
        this.prismaModelDelegate.aggregate({
          _sum: { [numericFieldToSum]: true },
          where: combinedWhereFilter,
        }),
        this.prismaModelDelegate.aggregate({
          _sum: { [numericFieldToSum]: true },
          where: currentPeriodWhereFilter,
        }),
        this.prismaModelDelegate.aggregate({
          _sum: { [numericFieldToSum]: true },
          where: previousPeriodWhereFilter,
        }),
      ]);

      total = Number(totalAggregatedResult?._sum?.[numericFieldToSum] || 0);
      thisPeriodCount = Number(
        currentPeriodAggregatedResult?._sum?.[numericFieldToSum] || 0,
      );
      lastPeriodCount = Number(
        previousPeriodAggregatedResult?._sum?.[numericFieldToSum] || 0,
      );
    } else {
      const [
        totalRecordsCount,
        currentPeriodRecordsCount,
        previousPeriodRecordsCount,
      ] = await Promise.all([
        this.prismaModelDelegate.count({ where: combinedWhereFilter }),
        this.prismaModelDelegate.count({ where: currentPeriodWhereFilter }),
        this.prismaModelDelegate.count({ where: previousPeriodWhereFilter }),
      ]);

      total = totalRecordsCount;
      thisPeriodCount = currentPeriodRecordsCount;
      lastPeriodCount = previousPeriodRecordsCount;
    }

    let percentageGrowthRate = 0;
    if (lastPeriodCount === 0) {
      percentageGrowthRate = thisPeriodCount > 0 ? 100 : 0;
    } else {
      const relativeDifference = thisPeriodCount - lastPeriodCount;
      percentageGrowthRate =
        Math.round((relativeDifference / lastPeriodCount) * 1000) / 10;
    }

    let growthDirectionType: GrowthType = 'no_change';
    if (percentageGrowthRate > 0) growthDirectionType = 'increase';
    else if (percentageGrowthRate < 0) growthDirectionType = 'decrease';

    const formattedPercentageGrowth =
      percentageGrowthRate > 0
        ? `+${percentageGrowthRate}%`
        : `${percentageGrowthRate}%`;

    recordDbQuery(Date.now() - queryExecutionStartTime, {
      model: this.databaseModelName,
      operation: 'analytics_growth',
      cacheHit: false,
    });

    return {
      total,
      thisPeriodCount,
      lastPeriodCount,
      growth: percentageGrowthRate,
      formattedGrowth: formattedPercentageGrowth,
      growthType: growthDirectionType,
    };
  }

  async getTimeTrends(
    options: IAnalyticsTimeTrendsOptions = {},
  ): Promise<ITrendPoint[]> {
    const queryExecutionStartTime = Date.now();
    const timeGranularityUnit = options.timeUnit || 'month';
    const numberOfBucketsToGenerate = Math.max(
      1,
      Math.min(options.limit || 6, 60),
    );
    const timestampFieldName = options.dateField || 'createdAt';
    const numericFieldToSum = options.sumField;
    const combinedWhereFilter = {
      ...this.persistentDefaultFilter,
      ...(options.where || {}),
    };
    const referenceDateAnchor = options.referenceDate || new Date();

    type TimeIntervalBucket = {
      intervalStartDate: Date;
      intervalEndDate: Date;
      displayLabel: string;
    };

    const timeIntervalBuckets: TimeIntervalBucket[] = [];

    for (
      let bucketIndex = numberOfBucketsToGenerate - 1;
      bucketIndex >= 0;
      bucketIndex--
    ) {
      const baseDate = new Date(referenceDateAnchor);

      if (timeGranularityUnit === 'month') {
        const intervalStartDate = new Date(
          baseDate.getFullYear(),
          baseDate.getMonth() - bucketIndex,
          1,
          0,
          0,
          0,
          0,
        );
        const intervalEndDate = new Date(
          baseDate.getFullYear(),
          baseDate.getMonth() - bucketIndex + 1,
          0,
          23,
          59,
          59,
          999,
        );
        const displayLabel = intervalStartDate.toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        });
        timeIntervalBuckets.push({
          intervalStartDate,
          intervalEndDate,
          displayLabel,
        });
      } else if (timeGranularityUnit === 'day') {
        const intervalStartDate = new Date(
          baseDate.getFullYear(),
          baseDate.getMonth(),
          baseDate.getDate() - bucketIndex,
          0,
          0,
          0,
          0,
        );
        const intervalEndDate = new Date(
          baseDate.getFullYear(),
          baseDate.getMonth(),
          baseDate.getDate() - bucketIndex,
          23,
          59,
          59,
          999,
        );
        const displayLabel = intervalStartDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        timeIntervalBuckets.push({
          intervalStartDate,
          intervalEndDate,
          displayLabel,
        });
      } else if (timeGranularityUnit === 'week') {
        const dayOfWeekOffset = baseDate.getDay();
        const intervalStartDate = new Date(
          baseDate.getFullYear(),
          baseDate.getMonth(),
          baseDate.getDate() - dayOfWeekOffset - bucketIndex * 7,
          0,
          0,
          0,
          0,
        );
        const intervalEndDate = new Date(intervalStartDate);
        intervalEndDate.setDate(intervalStartDate.getDate() + 6);
        intervalEndDate.setHours(23, 59, 59, 999);
        const displayLabel = `Week of ${intervalStartDate.toLocaleDateString(
          'en-US',
          {
            month: 'short',
            day: 'numeric',
          },
        )}`;
        timeIntervalBuckets.push({
          intervalStartDate,
          intervalEndDate,
          displayLabel,
        });
      } else if (timeGranularityUnit === 'year') {
        const intervalStartDate = new Date(
          baseDate.getFullYear() - bucketIndex,
          0,
          1,
          0,
          0,
          0,
          0,
        );
        const intervalEndDate = new Date(
          baseDate.getFullYear() - bucketIndex,
          11,
          31,
          23,
          59,
          59,
          999,
        );
        const displayLabel = String(intervalStartDate.getFullYear());
        timeIntervalBuckets.push({
          intervalStartDate,
          intervalEndDate,
          displayLabel,
        });
      }
    }

    const continuousTrendPoints: ITrendPoint[] = await Promise.all(
      timeIntervalBuckets.map(async currentBucket => {
        const bucketDateRangeFilter = {
          ...combinedWhereFilter,
          [timestampFieldName]: {
            gte: currentBucket.intervalStartDate,
            lte: currentBucket.intervalEndDate,
          },
        };

        if (numericFieldToSum) {
          const aggregatedBucketMetric =
            await this.prismaModelDelegate.aggregate({
              _sum: { [numericFieldToSum]: true },
              _count: { _all: true },
              where: bucketDateRangeFilter,
            });
          return {
            label: currentBucket.displayLabel,
            totalRevenue: Number(
              aggregatedBucketMetric?._sum?.[numericFieldToSum] || 0,
            ),
            transactionCount: Number(aggregatedBucketMetric?._count?._all || 0),
          };
        } else {
          const bucketRecordsCount = await this.prismaModelDelegate.count({
            where: bucketDateRangeFilter,
          });
          return {
            label: currentBucket.displayLabel,
            totalRevenue: 0,
            transactionCount: bucketRecordsCount,
          };
        }
      }),
    );

    recordDbQuery(Date.now() - queryExecutionStartTime, {
      model: this.databaseModelName,
      operation: 'analytics_trends',
      cacheHit: false,
    });

    return continuousTrendPoints;
  }

  async groupBy(
    options: IAnalyticsGroupByOptions,
  ): Promise<{ key: string; count: number; sum?: number }[]> {
    const queryExecutionStartTime = Date.now();
    const {
      by: targetGroupingField,
      sumField: numericFieldToSum,
      orderBy: groupSortOrder = 'count_desc',
      limit: maximumGroupsLimit,
    } = options;
    const combinedWhereFilter = {
      ...this.persistentDefaultFilter,
      ...(options.where || {}),
    };

    const rawPrismaGroupedRecords = await this.prismaModelDelegate.groupBy({
      by: [targetGroupingField],
      _count: { _all: true },
      ...(numericFieldToSum ? { _sum: { [numericFieldToSum]: true } } : {}),
      where: combinedWhereFilter,
    });

    let formattedGroupBreakdownList = (rawPrismaGroupedRecords || []).map(
      (groupedRecord: any) => ({
        key: String(groupedRecord[targetGroupingField] ?? 'Unknown'),
        count: Number(groupedRecord._count?._all || 0),
        ...(numericFieldToSum
          ? { sum: Number(groupedRecord._sum?.[numericFieldToSum] || 0) }
          : {}),
      }),
    );

    if (groupSortOrder === 'count_desc') {
      formattedGroupBreakdownList.sort(
        (firstGroup: any, secondGroup: any) =>
          secondGroup.count - firstGroup.count,
      );
    } else if (groupSortOrder === 'count_asc') {
      formattedGroupBreakdownList.sort(
        (firstGroup: any, secondGroup: any) =>
          firstGroup.count - secondGroup.count,
      );
    } else if (groupSortOrder === 'key_asc') {
      formattedGroupBreakdownList.sort((firstGroup: any, secondGroup: any) =>
        firstGroup.key.localeCompare(secondGroup.key),
      );
    }

    if (maximumGroupsLimit && maximumGroupsLimit > 0) {
      formattedGroupBreakdownList = formattedGroupBreakdownList.slice(
        0,
        maximumGroupsLimit,
      );
    }

    recordDbQuery(Date.now() - queryExecutionStartTime, {
      model: this.databaseModelName,
      operation: 'analytics_groupby',
      cacheHit: false,
    });

    return formattedGroupBreakdownList;
  }

  async summary(options: IAnalyticsSummaryOptions = {}): Promise<{
    count: number;
    sums: Record<string, number>;
    averages: Record<string, number>;
    mins: Record<string, number>;
    maxs: Record<string, number>;
  }> {
    const queryExecutionStartTime = Date.now();
    const combinedWhereFilter = {
      ...this.persistentDefaultFilter,
      ...(options.where || {}),
    };

    const prismaAggregatePayload: Record<string, any> = {
      _count: { _all: true },
    };

    if (options.sumFields?.length) {
      prismaAggregatePayload._sum = options.sumFields.reduce(
        (aggregatedFieldsAccumulator, targetFieldName) => ({
          ...aggregatedFieldsAccumulator,
          [targetFieldName]: true,
        }),
        {},
      );
    }
    if (options.avgFields?.length) {
      prismaAggregatePayload._avg = options.avgFields.reduce(
        (aggregatedFieldsAccumulator, targetFieldName) => ({
          ...aggregatedFieldsAccumulator,
          [targetFieldName]: true,
        }),
        {},
      );
    }
    if (options.minFields?.length) {
      prismaAggregatePayload._min = options.minFields.reduce(
        (aggregatedFieldsAccumulator, targetFieldName) => ({
          ...aggregatedFieldsAccumulator,
          [targetFieldName]: true,
        }),
        {},
      );
    }
    if (options.maxFields?.length) {
      prismaAggregatePayload._max = options.maxFields.reduce(
        (aggregatedFieldsAccumulator, targetFieldName) => ({
          ...aggregatedFieldsAccumulator,
          [targetFieldName]: true,
        }),
        {},
      );
    }

    const rawAggregatedResults = await this.prismaModelDelegate.aggregate({
      ...prismaAggregatePayload,
      where: combinedWhereFilter,
    });

    const calculatedFieldSums: Record<string, number> = {};
    if (options.sumFields) {
      for (const targetFieldName of options.sumFields) {
        calculatedFieldSums[targetFieldName] = Number(
          rawAggregatedResults?._sum?.[targetFieldName] || 0,
        );
      }
    }

    const calculatedFieldAverages: Record<string, number> = {};
    if (options.avgFields) {
      for (const targetFieldName of options.avgFields) {
        calculatedFieldAverages[targetFieldName] = Number(
          rawAggregatedResults?._avg?.[targetFieldName] || 0,
        );
      }
    }

    const calculatedFieldMinimums: Record<string, number> = {};
    if (options.minFields) {
      for (const targetFieldName of options.minFields) {
        calculatedFieldMinimums[targetFieldName] = Number(
          rawAggregatedResults?._min?.[targetFieldName] || 0,
        );
      }
    }

    const calculatedFieldMaximums: Record<string, number> = {};
    if (options.maxFields) {
      for (const targetFieldName of options.maxFields) {
        calculatedFieldMaximums[targetFieldName] = Number(
          rawAggregatedResults?._max?.[targetFieldName] || 0,
        );
      }
    }

    recordDbQuery(Date.now() - queryExecutionStartTime, {
      model: this.databaseModelName,
      operation: 'analytics_summary',
      cacheHit: false,
    });

    return {
      count: Number(rawAggregatedResults?._count?._all || 0),
      sums: calculatedFieldSums,
      averages: calculatedFieldAverages,
      mins: calculatedFieldMinimums,
      maxs: calculatedFieldMaximums,
    };
  }
}

export { PrismaAnalyticsBuilder as PrismaAggregationBuilder };
export default PrismaAnalyticsBuilder;
