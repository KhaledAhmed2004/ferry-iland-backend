import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError';
import { recordDbQuery } from '../logging/requestContext';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;
export const KM_PER_LAT_DEGREE = 111.32;

export type IBoundingBox = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export type IPaginationParams = {
  page: number;
  limit: number;
  skip: number;
};

// Validates latitude and longitude values against geographic limits (-90 to 90, -180 to 180).
export function validateCoordinates(
  latitude: number,
  longitude: number,
): void {
  if (latitude < -90 || latitude > 90) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Latitude must be between -90 and 90 degrees',
    );
  }
  if (longitude < -180 || longitude > 180) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Longitude must be between -180 and 180 degrees',
    );
  }
}

// Calculates an index-friendly latitude/longitude bounding box around a center coordinate.
export function calculateBoundingBox(
  latitude: number,
  longitude: number,
  distanceInKilometers: number,
): IBoundingBox {
  const latitudeDelta = distanceInKilometers / KM_PER_LAT_DEGREE;
  const latitudeRadians = (latitude * Math.PI) / 180;
  const cosineLatitude = Math.cos(latitudeRadians);
  const longitudeDelta =
    distanceInKilometers / (KM_PER_LAT_DEGREE * (cosineLatitude || 1e-6));

  return {
    minLat: latitude - latitudeDelta,
    maxLat: latitude + latitudeDelta,
    minLng: longitude - longitudeDelta,
    maxLng: longitude + longitudeDelta,
  };
}

// Extracts a sanitized numeric value from a query dictionary with NaN and Infinity protection.
export function extractNumber(
  queryRecord: Record<string, unknown>,
  queryKey: string,
  fallbackValue?: number,
  options: { integer?: boolean } = {},
): number | undefined {
  const rawValue = queryRecord[queryKey];
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return options.integer ? Math.floor(rawValue) : rawValue;
  }
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (
      !trimmed ||
      trimmed === 'NaN' ||
      trimmed === 'Infinity' ||
      trimmed === '-Infinity'
    ) {
      return fallbackValue;
    }
    const parsedNumber = parseFloat(trimmed);
    if (Number.isFinite(parsedNumber)) {
      return options.integer ? Math.floor(parsedNumber) : parsedNumber;
    }
  }
  return fallbackValue;
}

// Extracts, bounds-checks, and computes offset pagination parameters (page, limit, skip).
export function extractPaginationParams(
  queryRecord: Record<string, unknown>,
  defaultLimit: number = DEFAULT_LIMIT,
  maxLimit: number = MAX_LIMIT,
  defaultPage: number = DEFAULT_PAGE,
): IPaginationParams {
  const requestedLimit =
    extractNumber(queryRecord, 'limit', defaultLimit, { integer: true }) ??
    defaultLimit;
  const normalizedLimit = Math.min(Math.max(1, requestedLimit), maxLimit);

  const requestedPage =
    extractNumber(queryRecord, 'page', defaultPage, { integer: true }) ??
    defaultPage;
  const normalizedPage = Math.max(1, requestedPage);

  const calculatedSkip = (normalizedPage - 1) * normalizedLimit;

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: calculatedSkip,
  };
}

// Computes the total number of pages based on total records and page size.
export function calculateTotalPages(
  totalRecordCount: number,
  pageSize: number,
): number {
  return Math.ceil(totalRecordCount / Math.max(1, pageSize));
}

// Strips optional '+' or '-' sorting direction prefix to retrieve the clean field name.
export function stripSortPrefix(fieldName: string): string {
  return fieldName.startsWith('-') || fieldName.startsWith('+')
    ? fieldName.substring(1)
    : fieldName;
}

// Parses a comma-separated sorting parameter string into an array of sanitized field tokens.
export function parseSortTokens(
  rawSortString: string,
  isDangerousKey: (_key: string) => boolean,
  allowedSortFields?: string[],
): string[] {
  return rawSortString
    .split(',')
    .map(token => token.trim())
    .filter(token => {
      if (!token || isDangerousKey(token)) return false;
      if (allowedSortFields && allowedSortFields.length > 0) {
        return allowedSortFields.includes(stripSortPrefix(token));
      }
      return true;
    });
}

// eslint-disable-next-line @typescript-eslint/ban-types
export type FieldKey<T> = Extract<keyof T, string> | (string & {});

export type IPaginationInfo = {
  total: number;
  limit: number;
  page: number;
  totalPage: number;
};

export type IQueryResult<T> = {
  data: T[];
  pagination: IPaginationInfo;
};

export type CursorSortOrder = 'asc' | 'desc';

export type ICursorPaginationInfo = {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
};

export type ICursorQueryResult<T> = {
  cursor: ICursorPaginationInfo;
  data: T[];
};

export type ICursorOptions = {
  defaultLimit?: number;
  maxLimit?: number;
  cursorField?: string;
  order?: CursorSortOrder;
};

export type IFilterOptions<T = Record<string, unknown>> = {
  customExcludes?: string[];
  categoryField?: FieldKey<T>;
};

export interface IPrismaModelDelegate<T = Record<string, unknown>> {
  findMany(args?: any): Promise<T[]>;
  count(args?: any): Promise<number>;
  [key: string]: any;
}

/**
 * Enterprise-grade PostgreSQL / Prisma Query Builder.
 *
 * Provides a fluent, self-documenting interface for:
 * - Filtering with automatic framework key exclusion
 * - Case-insensitive multi-field and relational search
 * - Offset and cursor-based pagination with lookahead slicing
 * - Multi-column sorting with ascending/descending prefix detection
 * - Numeric range and date range filters
 * - Bounding box geospatial range queries
 */
export class PrismaQueryBuilder<T = Record<string, unknown>> {
  public model: IPrismaModelDelegate<T>;
  public query: Record<string, unknown>;
  public modelName: string;

  public whereConditions: Record<string, any> = {};
  public orderByList: Record<string, 'asc' | 'desc'>[] = [];
  public paginationParams: {
    skip?: number;
    take?: number;
    page?: number;
    limit?: number;
  } = {};
  public selectFields?: Record<string, boolean>;
  public includeRelations?: Record<string, any>;

  private isPaginated = false;
  private cursorOptions?: {
    cursorField: string;
    order: CursorSortOrder;
    limit: number;
  };

  constructor(
    model: IPrismaModelDelegate<T>,
    query: Record<string, unknown> = {},
    modelName: string = 'PrismaModel',
  ) {
    this.model = model;
    this.query = query || {};
    this.modelName = modelName;
  }

  // Guard against prototype pollution and malicious query operators.
  private isDangerousKey(key: string): boolean {
    if (!key || typeof key !== 'string') return true;
    const lower = key.toLowerCase();
    return (
      lower.includes('__proto__') ||
      lower.includes('constructor') ||
      lower.includes('prototype') ||
      lower.includes('$')
    );
  }

  // Extracts a trimmed non-empty string parameter from query.
  private getString(queryKey: string, defaultValue?: string): string | undefined {
    const rawValue = this.query[queryKey];
    if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      return trimmed.length > 0 ? trimmed : defaultValue;
    }
    if (Array.isArray(rawValue) && typeof rawValue[0] === 'string') {
      const trimmed = rawValue[0].trim();
      return trimmed.length > 0 ? trimmed : defaultValue;
    }
    return defaultValue;
  }

  // Extracts an array of sanitized string tokens (handles comma-separated strings or native arrays).
  private getArray(queryKey: string): string[] {
    const rawValue = this.query[queryKey];
    if (!rawValue) return [];
    if (Array.isArray(rawValue)) {
      return rawValue
        .map(item =>
          typeof item === 'string' ? item.trim() : String(item).trim(),
        )
        .filter(item => item.length > 0 && !this.isDangerousKey(item));
    }
    if (typeof rawValue === 'string') {
      return rawValue
        .split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0 && !this.isDangerousKey(item));
    }
    return [];
  }

  // Extracts a numeric parameter safely.
  private getNumber(
    queryKey: string,
    defaultValue?: number,
    options: { integer?: boolean } = {},
  ): number | undefined {
    return extractNumber(this.query, queryKey, defaultValue, options);
  }

  // Appends a condition into the top-level AND list.
  private addAndCondition(condition: Record<string, any>): void {
    if (!this.whereConditions.AND) {
      this.whereConditions.AND = [];
    } else if (!Array.isArray(this.whereConditions.AND)) {
      this.whereConditions.AND = [this.whereConditions.AND];
    }
    (this.whereConditions.AND as Record<string, any>[]).push(condition);
  }

  // Constructs case-insensitive contains condition, supporting nested relation paths (e.g. 'operatorProfile.companyName').
  private buildSearchCondition(
    fieldPath: string,
    searchTerm: string,
  ): Record<string, any> {
    const pathSegments = fieldPath.split('.');
    if (pathSegments.length === 1) {
      return {
        [fieldPath]: {
          contains: searchTerm,
          mode: 'insensitive',
        },
      };
    }

    let nestedCondition: Record<string, any> = {
      contains: searchTerm,
      mode: 'insensitive',
    };

    for (let index = pathSegments.length - 1; index >= 0; index--) {
      const segment = pathSegments[index];
      if (index === pathSegments.length - 1) {
        nestedCondition = {
          [segment]: { contains: searchTerm, mode: 'insensitive' },
        };
      } else {
        nestedCondition = { [segment]: nestedCondition };
      }
    }
    return nestedCondition;
  }

  /**
   * Search across multiple fields using PostgreSQL case-insensitive matching.
   * Supports relational dot-notation (e.g. 'operatorProfile.companyName').
   */
  search(searchableFields: FieldKey<T>[], maxSearchLength = 256) {
    let rawSearchTerm =
      this.getString('searchTerm') || this.getString('search');

    if (rawSearchTerm && searchableFields.length > 0) {
      if (rawSearchTerm.length > maxSearchLength) {
        rawSearchTerm = rawSearchTerm.substring(0, maxSearchLength);
      }
      const orSearchConditions = searchableFields.map(field =>
        this.buildSearchCondition(field as string, rawSearchTerm!),
      );
      this.addAndCondition({ OR: orSearchConditions });
    }
    return this;
  }

  /**
   * General key-value query filtering with automatic removal of reserved framework parameters.
   */
  filter(options: IFilterOptions<T> = {}) {
    const frameworkReservedKeys = [
      'searchTerm',
      'search',
      'sort',
      'page',
      'limit',
      'fields',
      'include',
      'select',
      'timeFilter',
      'start',
      'end',
      'startDate',
      'endDate',
      'category',
      'latitude',
      'longitude',
      'distance',
      'maxDistance',
      'minDistance',
      'radius',
      'geoField',
      'geoMode',
      'swLat',
      'swLng',
      'neLat',
      'neLng',
      'polygon',
      'poly',
      'minPrice',
      'maxPrice',
      ...(options.customExcludes || []),
    ];

    const reservedKeysSet = new Set(frameworkReservedKeys);

    for (const [queryKey, rawQueryValue] of Object.entries(this.query)) {
      if (
        !reservedKeysSet.has(queryKey) &&
        !this.isDangerousKey(queryKey) &&
        rawQueryValue !== undefined &&
        rawQueryValue !== ''
      ) {
        let coercedValue: unknown = rawQueryValue;
        if (typeof coercedValue === 'string') {
          const trimmed = coercedValue.trim();
          if (trimmed === 'true') coercedValue = true;
          else if (trimmed === 'false') coercedValue = false;
          else coercedValue = trimmed;
        }
        this.whereConditions[queryKey] = coercedValue;
      }
    }

    if (options.categoryField) {
      this.categoryFilter(options.categoryField);
    }

    return this;
  }

  /**
   * Injects direct business-rule filtering conditions (e.g. { isDeleted: false, role: 'USER' }).
   */
  where(customConditions: Record<string, any>) {
    if (customConditions && typeof customConditions === 'object') {
      Object.assign(this.whereConditions, customConditions);
    }
    return this;
  }

  /**
   * Applies numeric range filtering (min/max boundaries) on a target field.
   */
  range(
    targetDatabaseField: FieldKey<T>,
    customMinKey?: string,
    customMaxKey?: string,
  ) {
    const targetFieldString = targetDatabaseField as string;
    const capitalizedFieldName =
      targetFieldString.charAt(0).toUpperCase() + targetFieldString.slice(1);

    const minParamKey = customMinKey || `min${capitalizedFieldName}`;
    const maxParamKey = customMaxKey || `max${capitalizedFieldName}`;

    const minimumValue = this.getNumber(minParamKey);
    const maximumValue = this.getNumber(maxParamKey);

    const rangeFilter: Record<string, number> = {};
    if (minimumValue !== undefined) rangeFilter.gte = minimumValue;
    if (maximumValue !== undefined) rangeFilter.lte = maximumValue;

    if (Object.keys(rangeFilter).length > 0) {
      const existingFieldFilter =
        typeof this.whereConditions[targetFieldString] === 'object' &&
        this.whereConditions[targetFieldString] !== null
          ? this.whereConditions[targetFieldString]
          : {};
      this.whereConditions[targetFieldString] = {
        ...existingFieldFilter,
        ...rangeFilter,
      };
    }
    return this;
  }

  /**
   * Filter records matching any category in an array (Prisma 'in' operator).
   */
  categoryFilter(
    targetCategoryField: FieldKey<T> = 'category',
    queryParamKey: string = 'category',
  ) {
    const selectedCategories = this.getArray(queryParamKey);
    if (selectedCategories.length > 0) {
      this.whereConditions[targetCategoryField as string] = {
        in: selectedCategories,
      };
    }
    return this;
  }

  // Resolves preset or custom date ranges into Prisma gte/lte criteria.
  private resolveDateRange(
    timeFilterPreset?: string,
    customStartDateParam?: string,
    customEndDateParam?: string,
  ): { gte?: Date; lte?: Date } | undefined {
    const currentDate = new Date();

    if (timeFilterPreset === 'recently') {
      const oneDayAgo = new Date(currentDate);
      oneDayAgo.setDate(currentDate.getDate() - 1);
      return { gte: oneDayAgo, lte: currentDate };
    }

    if (timeFilterPreset === 'weekly') {
      return {
        gte: startOfWeek(currentDate, { weekStartsOn: 1 }),
        lte: endOfWeek(currentDate, { weekStartsOn: 1 }),
      };
    }

    if (timeFilterPreset === 'monthly') {
      return {
        gte: startOfMonth(currentDate),
        lte: endOfMonth(currentDate),
      };
    }

    if (
      timeFilterPreset === 'custom' ||
      (customStartDateParam && customEndDateParam)
    ) {
      if (!customStartDateParam || !customEndDateParam) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Custom date filter requires both 'start' and 'end' query parameters.",
        );
      }

      const parsedStartDate = new Date(customStartDateParam);
      const parsedEndDate = new Date(customEndDateParam);

      if (
        isNaN(parsedStartDate.getTime()) ||
        isNaN(parsedEndDate.getTime())
      ) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Invalid date format. Use ISO / 'YYYY-MM-DD' format for 'start' and 'end'.",
        );
      }

      if (parsedStartDate > parsedEndDate) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "'start' date cannot be after 'end' date.",
        );
      }

      return { gte: parsedStartDate, lte: parsedEndDate };
    }

    return undefined;
  }

  /**
   * Date filtering supporting presets ('recently', 'weekly', 'monthly') and custom start/end ranges.
   */
  dateFilter(targetDateField: FieldKey<T> = 'createdAt') {
    const timeFilterPreset = this.getString('timeFilter');
    const customStartDateParam =
      this.getString('start') || this.getString('startDate');
    const customEndDateParam =
      this.getString('end') || this.getString('endDate');

    if (!timeFilterPreset && !customStartDateParam && !customEndDateParam) {
      return this;
    }

    const computedDateRange = this.resolveDateRange(
      timeFilterPreset,
      customStartDateParam,
      customEndDateParam,
    );

    if (computedDateRange) {
      const fieldString = targetDateField as string;
      const existingFieldFilter =
        typeof this.whereConditions[fieldString] === 'object' &&
        this.whereConditions[fieldString] !== null
          ? this.whereConditions[fieldString]
          : {};
      this.whereConditions[fieldString] = {
        ...existingFieldFilter,
        ...(computedDateRange.gte && { gte: computedDateRange.gte }),
        ...(computedDateRange.lte && { lte: computedDateRange.lte }),
      };
    }

    return this;
  }

  /**
   * Geospatial filtering using an index-friendly latitude/longitude bounding box.
   */
  locationFilter(
    latitudeFieldName: FieldKey<T> = 'latitude',
    longitudeFieldName: FieldKey<T> = 'longitude',
  ) {
    const latitude = this.getNumber('latitude');
    const longitude = this.getNumber('longitude');
    const radiusInKilometers = this.getNumber('distance');

    if (
      latitude !== undefined &&
      longitude !== undefined &&
      radiusInKilometers !== undefined
    ) {
      validateCoordinates(latitude, longitude);
      if (radiusInKilometers <= 0) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'Distance must be greater than 0',
        );
      }

      const { minLat, maxLat, minLng, maxLng } = calculateBoundingBox(
        latitude,
        longitude,
        radiusInKilometers,
      );

      this.whereConditions[latitudeFieldName as string] = {
        gte: minLat,
        lte: maxLat,
      };
      this.whereConditions[longitudeFieldName as string] = {
        gte: minLng,
        lte: maxLng,
      };
    }

    return this;
  }

  /**
   * Multi-column sorting supporting '+' and '-' direction indicators (e.g. '-createdAt,price').
   */
  sort(
    defaultSortCriteria: string = '-createdAt',
    allowedSortFields?: FieldKey<T>[],
  ) {
    const rawSortQuery = this.getString('sort', defaultSortCriteria);
    if (!rawSortQuery) {
      this.orderByList = [{ createdAt: 'desc' }];
      return this;
    }

    const sortTokens = parseSortTokens(
      rawSortQuery,
      key => this.isDangerousKey(key),
      allowedSortFields as string[] | undefined,
    );

    const prismaOrderByList: Record<string, 'asc' | 'desc'>[] = [];

    for (const token of sortTokens) {
      if (token.startsWith('-')) {
        const fieldName = token.substring(1);
        if (fieldName) prismaOrderByList.push({ [fieldName]: 'desc' });
      } else {
        const fieldName = token.startsWith('+') ? token.substring(1) : token;
        if (fieldName) prismaOrderByList.push({ [fieldName]: 'asc' });
      }
    }

    this.orderByList =
      prismaOrderByList.length > 0
        ? prismaOrderByList
        : [{ createdAt: 'desc' }];

    return this;
  }

  /**
   * Configure offset pagination with page, limit, and maximum limit guards.
   */
  paginate(
    defaultLimit: number = DEFAULT_LIMIT,
    maxLimit: number = MAX_LIMIT,
  ) {
    this.isPaginated = true;
    const pagination = extractPaginationParams(
      this.query,
      defaultLimit,
      maxLimit,
      DEFAULT_PAGE,
    );

    this.paginationParams = {
      page: pagination.page,
      limit: pagination.limit,
      skip: pagination.skip,
      take: pagination.limit,
    };
    return this;
  }

  /**
   * Include related Prisma models (foreign key joins).
   */
  include(relationsToInclude: Record<string, any>) {
    if (relationsToInclude && typeof relationsToInclude === 'object') {
      this.includeRelations = {
        ...(this.includeRelations || {}),
        ...relationsToInclude,
      };
    }
    return this;
  }

  /**
   * Select specific columns to return (Prisma field projection).
   */
  select(fieldsToSelect: Record<string, boolean>) {
    if (fieldsToSelect && typeof fieldsToSelect === 'object') {
      this.selectFields = {
        ...(this.selectFields || {}),
        ...fieldsToSelect,
      };
    }
    return this;
  }

  /**
   * Dynamic field projection based on query parameter 'fields'.
   */
  fields(defaultFields?: string, allowedFields?: FieldKey<T>[]) {
    const requestedFields = this.getArray('fields');
    const allowed = allowedFields as string[] | undefined;
    const allowedRequestedFields = requestedFields.filter(fieldName => {
      if (!fieldName || this.isDangerousKey(fieldName)) return false;
      const cleanFieldName = stripSortPrefix(fieldName);
      if (allowed && allowed.length > 0) {
        return allowed.includes(cleanFieldName);
      }
      return true;
    });

    const finalFieldsToProject =
      allowedRequestedFields.length > 0
        ? allowedRequestedFields
        : defaultFields
          ? defaultFields.split(',').map(s => s.trim())
          : [];

    if (finalFieldsToProject.length > 0) {
      const prismaSelectMap: Record<string, boolean> = {};
      for (const field of finalFieldsToProject) {
        prismaSelectMap[stripSortPrefix(field)] = true;
      }
      this.select(prismaSelectMap);
    }
    return this;
  }

  // Aliases for clean readability
  only(fieldsToSelect: string | string[]) {
    return this.fields(
      Array.isArray(fieldsToSelect) ? fieldsToSelect.join(',') : fieldsToSelect,
    );
  }

  pick(fieldsToSelect: string | string[]) {
    return this.fields(
      Array.isArray(fieldsToSelect) ? fieldsToSelect.join(',') : fieldsToSelect,
    );
  }

  project(fieldsToSelect: string | string[]) {
    return this.fields(
      Array.isArray(fieldsToSelect) ? fieldsToSelect.join(',') : fieldsToSelect,
    );
  }

  /**
   * Executes data retrieval and total record count in parallel using Promise.all.
   */
  async execute(): Promise<IQueryResult<T>> {
    if (!this.isPaginated) {
      this.paginate(DEFAULT_LIMIT, MAX_LIMIT);
    }

    const prismaQueryOptions: Record<string, any> = {
      where: this.whereConditions,
      skip: this.paginationParams.skip,
      take: this.paginationParams.take,
    };

    if (this.orderByList.length > 0) {
      prismaQueryOptions.orderBy = this.orderByList;
    }

    if (
      this.includeRelations &&
      Object.keys(this.includeRelations).length > 0
    ) {
      prismaQueryOptions.include = this.includeRelations;
    } else if (this.selectFields && Object.keys(this.selectFields).length > 0) {
      prismaQueryOptions.select = this.selectFields;
    }

    const queryStartTime = Date.now();
    const [queriedRecords, totalRecordCount] = await Promise.all([
      this.model.findMany(prismaQueryOptions),
      this.model.count({ where: this.whereConditions }),
    ]);
    const executionDurationMs = Date.now() - queryStartTime;

    recordDbQuery(executionDurationMs, {
      model: this.modelName,
      operation: 'findMany_and_count',
      cacheHit: false,
    });

    const currentPage = this.paginationParams.page ?? DEFAULT_PAGE;
    const currentPageSize = this.paginationParams.limit ?? DEFAULT_LIMIT;
    const totalPageCount = calculateTotalPages(
      totalRecordCount,
      currentPageSize,
    );

    return {
      data: queriedRecords,
      pagination: {
        total: totalRecordCount,
        limit: currentPageSize,
        page: currentPage,
        totalPage: totalPageCount,
      },
    };
  }

  /**
   * Retrieves count and pagination metadata without fetching the actual records.
   */
  async getPaginationInfo(): Promise<IPaginationInfo> {
    const queryStartTime = Date.now();
    const totalRecordCount = await this.model.count({
      where: this.whereConditions,
    });
    const executionDurationMs = Date.now() - queryStartTime;

    recordDbQuery(executionDurationMs, {
      model: this.modelName,
      operation: 'count',
      cacheHit: false,
    });

    const currentPage =
      this.paginationParams.page ??
      this.getNumber('page', DEFAULT_PAGE, { integer: true }) ??
      DEFAULT_PAGE;
    const rawLimit =
      this.paginationParams.limit ??
      this.getNumber('limit', DEFAULT_LIMIT, { integer: true }) ??
      DEFAULT_LIMIT;
    const currentPageSize = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
    const totalPageCount = calculateTotalPages(
      totalRecordCount,
      currentPageSize,
    );

    return {
      total: totalRecordCount,
      limit: currentPageSize,
      page: currentPage,
      totalPage: totalPageCount,
    };
  }

  // Alias for cursor pagination setup
  cursor(field: FieldKey<T> = 'id', order: CursorSortOrder = 'asc') {
    return this.cursorPaginate(field, order);
  }

  /**
   * Configures cursor pagination for infinite feeds and real-time streams.
   */
  cursorPaginate(
    cursorField: FieldKey<T> = 'id',
    order: CursorSortOrder = 'asc',
    defaultLimit: number = 20,
    maxLimit: number = 100,
  ) {
    const requestedLimit = this.getNumber('limit', defaultLimit, {
      integer: true,
    });
    const normalizedLimit = Math.min(
      Math.max(1, requestedLimit ?? defaultLimit),
      maxLimit,
    );

    this.cursorOptions = {
      cursorField: String(cursorField),
      order,
      limit: normalizedLimit,
    };
    return this;
  }

  // Decodes and parses base64url cursor tokens safely.
  private parseCursorToken(): Record<string, unknown> | null {
    const rawCursorParam = this.query.cursor;
    if (
      !rawCursorParam ||
      typeof rawCursorParam !== 'string' ||
      rawCursorParam.trim() === ''
    ) {
      return null;
    }

    let parsedCursorPayload: Record<string, unknown>;
    try {
      const decodedJsonString = Buffer.from(
        rawCursorParam,
        'base64url',
      ).toString('utf8');
      parsedCursorPayload = JSON.parse(decodedJsonString);
    } catch {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid cursor token');
    }

    if (
      !parsedCursorPayload ||
      typeof parsedCursorPayload !== 'object' ||
      Array.isArray(parsedCursorPayload)
    ) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid cursor token');
    }

    return parsedCursorPayload;
  }

  /**
   * Executes cursor pagination query using limit + 1 lookahead for instant 'hasMore' detection.
   */
  async executeCursor(): Promise<ICursorQueryResult<T>> {
    if (!this.cursorOptions) {
      this.cursorPaginate('id', 'asc', 20, 100);
    }

    const { cursorField, order, limit } = this.cursorOptions!;
    const cursorData = this.parseCursorToken();

    const cursorWhereClause: Record<string, any> = { ...this.whereConditions };

    if (cursorData) {
      const comparisonOperator = order === 'asc' ? 'gt' : 'lt';
      const cursorFieldValue =
        cursorData[cursorField] ?? cursorData.id ?? cursorData._id;

      if (cursorField === 'id') {
        const cursorPrimaryId = String(
          cursorData.id ?? cursorData._id ?? '',
        );
        if (cursorWhereClause.id) {
          cursorWhereClause.AND = cursorWhereClause.AND || [];
          cursorWhereClause.AND.push({
            id: { [comparisonOperator]: cursorPrimaryId },
          });
        } else {
          cursorWhereClause.id = { [comparisonOperator]: cursorPrimaryId };
        }
      } else {
        const cursorPrimaryId = cursorData.id ?? cursorData._id;
        if (cursorPrimaryId !== undefined) {
          const tieBreakerOrCondition = [
            { [cursorField]: { [comparisonOperator]: cursorFieldValue } },
            {
              [cursorField]: cursorFieldValue,
              id: { [comparisonOperator]: String(cursorPrimaryId) },
            },
          ];
          cursorWhereClause.AND = cursorWhereClause.AND || [];
          cursorWhereClause.AND.push({ OR: tieBreakerOrCondition });
        } else {
          cursorWhereClause[cursorField] = {
            [comparisonOperator]: cursorFieldValue,
          };
        }
      }
    }

    const prismaOrderBy: Record<string, 'asc' | 'desc'>[] = [
      { [cursorField]: order },
      ...(cursorField !== 'id' ? [{ id: order }] : []),
    ];

    const prismaQueryOptions: Record<string, any> = {
      where: cursorWhereClause,
      take: limit + 1, // Lookahead 1 extra item to check if more records exist
      orderBy: prismaOrderBy,
    };

    if (
      this.includeRelations &&
      Object.keys(this.includeRelations).length > 0
    ) {
      prismaQueryOptions.include = this.includeRelations;
    } else if (this.selectFields && Object.keys(this.selectFields).length > 0) {
      prismaQueryOptions.select = this.selectFields;
    }

    const queryStartTime = Date.now();
    const fetchedRecordsWithLookahead =
      await this.model.findMany(prismaQueryOptions);
    const executionDurationMs = Date.now() - queryStartTime;

    recordDbQuery(executionDurationMs, {
      model: this.modelName,
      operation: 'execute_cursor',
      cacheHit: false,
    });

    const hasMoreRecords = fetchedRecordsWithLookahead.length > limit;
    const resultRecords = hasMoreRecords
      ? fetchedRecordsWithLookahead.slice(0, limit)
      : fetchedRecordsWithLookahead;

    let nextCursorToken: string | null = null;
    if (hasMoreRecords && resultRecords.length > 0) {
      const lastRecordInBatch = resultRecords[
        resultRecords.length - 1
      ] as Record<string, any>;

      const nextCursorPayload: Record<string, unknown> = {
        id: lastRecordInBatch.id ?? lastRecordInBatch._id,
      };

      if (cursorField !== 'id') {
        nextCursorPayload[cursorField] = lastRecordInBatch[cursorField];
      }

      nextCursorToken = Buffer.from(
        JSON.stringify(nextCursorPayload),
      ).toString('base64url');
    }

    return {
      cursor: {
        nextCursor: nextCursorToken,
        hasMore: hasMoreRecords,
        limit,
      },
      data: resultRecords as T[],
    };
  }

  // Returns a clone of current where conditions.
  getWhere(): Record<string, any> {
    return { ...this.whereConditions };
  }

  // Returns a clone of current orderBy criteria.
  getOrderBy(): Record<string, 'asc' | 'desc'>[] {
    return [...this.orderByList];
  }
}

export default PrismaQueryBuilder;
