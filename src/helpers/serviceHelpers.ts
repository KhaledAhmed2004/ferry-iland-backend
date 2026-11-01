import mongoose, { Model, Types } from 'mongoose';
import ApiError from '../errors/ApiError';
import { StatusCodes } from 'http-status-codes';

// Type for ID parameters that can be either string or ObjectId
type IdType = string | Types.ObjectId;

// Common query options for helper operations
type QueryOpts = {
  projection?: Record<string, 0 | 1>;
  lean?: boolean;
  session?: mongoose.ClientSession;
};

export const validateObjectIdOrThrow = (id: IdType, field = 'id'): void => {
  const s = (id as any)?.toString?.() ?? String(id);
  if (!Types.ObjectId.isValid(s)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid ${field}: ${s}`);
  }
};

// Helper to exclude soft deleted docs by default
export const notDeleted = (extra: Record<string, unknown> = {}) => ({
  isDeleted: { $ne: true },
  ...extra,
});

/**
 * Generic function to find a document by ID with error handling
 * @param model - Mongoose model
 * @param id - Document ID (string or ObjectId)
 * @param entityName - Name of the entity for error messages
 * @returns Found document
 * @throws ApiError if document not found
 */
export const findByIdOrThrow = async <T>(
  model: Model<T>,
  id: IdType,
  entityName: string = 'Resource',
  opts: QueryOpts = {}
): Promise<T> => {
  validateObjectIdOrThrow(id);
  let q = model.findById(id, opts.projection);
  if (opts.session) q = q.session(opts.session);
  if (opts.lean) q = q.lean() as any;
  const document = await q;
  if (!document) {
    throw new ApiError(StatusCodes.NOT_FOUND, `${entityName} not found (${String(id)})`);
  }
  return document as T;
};

/**
 * Generic function to update a document by ID with validation
 * @param model - Mongoose model
 * @param id - Document ID (string or ObjectId)
 * @param updateData - Data to update
 * @param entityName - Name of the entity for error messages
 * @returns Updated document
 * @throws ApiError if document not found
 */
export const updateByIdOrThrow = async <T>(
  model: Model<T>,
  id: IdType,
  updateData: Partial<T>,
  entityName: string = 'Resource',
  opts: Omit<QueryOpts, 'lean'> = {}
): Promise<T> => {
  validateObjectIdOrThrow(id);
  let q = model.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  });
  if (opts.session) q = q.session(opts.session);
  if (opts.projection) q = q.select(opts.projection);
  const updatedDocument = await q;
  
  if (!updatedDocument) {
    throw new ApiError(StatusCodes.NOT_FOUND, `${entityName} not found (${String(id)})`);
  }
  
  return updatedDocument as T;
};

/**
 * Generic function to delete a document by ID with validation
 * @param model - Mongoose model
 * @param id - Document ID (string or ObjectId)
 * @param entityName - Name of the entity for error messages
 * @returns Deleted document
 * @throws ApiError if document not found
 */
export const deleteByIdOrThrow = async <T>(
  model: Model<T>,
  id: IdType,
  entityName: string = 'Resource'
): Promise<T> => {
  validateObjectIdOrThrow(id);
  const deletedDocument = await model.findByIdAndDelete(id);
  if (!deletedDocument) {
    throw new ApiError(StatusCodes.NOT_FOUND, `${entityName} not found (${String(id)})`);
  }
  return deletedDocument;
};

/**
 * Generic function to soft delete a document (set isDeleted: true)
 * @param model - Mongoose model
 * @param id - Document ID (string or ObjectId)
 * @param entityName - Name of the entity for error messages
 * @returns Updated document
 * @throws ApiError if document not found
 */
export const softDeleteByIdOrThrow = async <T>(
  model: Model<T>,
  id: IdType,
  entityName: string = 'Resource',
  opts: Omit<QueryOpts, 'lean'> = {}
): Promise<T> => {
  validateObjectIdOrThrow(id);
  let q = model.findByIdAndUpdate(
    id,
    { isDeleted: true, deletedAt: new Date() },
    { new: true, runValidators: true }
  );
  if (opts.session) q = q.session(opts.session);
  if (opts.projection) q = q.select(opts.projection);
  const updatedDocument = await q;
  
  if (!updatedDocument) {
    throw new ApiError(StatusCodes.NOT_FOUND, `${entityName} not found (${String(id)})`);
  }
  
  return updatedDocument as T;
};

export const restoreByIdOrThrow = async <T>(
  model: Model<T>,
  id: IdType,
  entityName: string = 'Resource',
  opts: Omit<QueryOpts, 'lean'> = {}
): Promise<T> => {
  validateObjectIdOrThrow(id);
  let q = model.findByIdAndUpdate(
    id,
    { isDeleted: false, deletedAt: null },
    { new: true, runValidators: true }
  );
  if (opts.session) q = q.session(opts.session);
  if (opts.projection) q = q.select(opts.projection);
  const updatedDocument = await q;
  
  if (!updatedDocument) {
    throw new ApiError(StatusCodes.NOT_FOUND, `${entityName} not found (${String(id)})`);
  }
  
  return updatedDocument as T;
};

/**
 * Check if a document exists by ID
 * @param model - Mongoose model
 * @param id - Document ID (string or ObjectId)
 * @returns Boolean indicating existence
 */
export const existsById = async <T>(
  model: Model<T>,
  id: IdType
): Promise<boolean> => {
  validateObjectIdOrThrow(id);
  const res = await model.exists({ _id: id });
  return !!res;
};

/**
 * Get document count with optional filter
 * @param model - Mongoose model
 * @param filter - Optional filter conditions
 * @returns Document count
 */
export const getCount = async <T>(
  model: Model<T>,
  filter: Record<string, unknown> = {}
): Promise<number> => {
  const isEmpty = Object.keys(filter).length === 0;
  if (isEmpty) return model.estimatedDocumentCount();
  return await model.countDocuments(filter);
};

/**
 * Run a set of operations inside a MongoDB transaction
 * @param fn - Callback that receives the session and returns a result
 * @returns Result of the callback after commit
 */
export const withTransaction = async <T>(
  fn: (session: mongoose.ClientSession) => Promise<T>,
  opts?: {
    readConcern?: { level: 'snapshot' | 'majority' | 'local' };
    writeConcern?: { w?: 'majority' | number; j?: boolean };
    maxRetries?: number;
  }
): Promise<T> => {
  const session = await mongoose.startSession();
  const readConcern = opts?.readConcern ?? { level: 'snapshot' };
  const writeConcern = opts?.writeConcern ?? { w: 'majority', j: true };
  const maxRetries = Math.max(0, opts?.maxRetries ?? 0);

  let attempt = 0;
  while (true) {
    try {
      await session.startTransaction({ readConcern, writeConcern });
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (error: any) {
      await session.abortTransaction();
      const transient = !!error?.errorLabels?.includes?.('TransientTransactionError');
      if (transient && attempt < maxRetries) {
        attempt += 1;
        continue;
      }
      throw error;
    } finally {
      session.endSession();
    }
  }
};

/**
 * Ensure a document's status matches expected value(s), otherwise throw
 * @param currentStatus - The current status value
 * @param expected - A single expected status or a list of allowed statuses
 * @param options - Optional error customization
 */
export const ensureStatusOrThrow = <S extends string | number>(
  currentStatus: S,
  expected: S | S[],
  options?: { entityName?: string; message?: string; code?: number }
): void => {
  const ok = Array.isArray(expected)
    ? (expected as S[]).includes(currentStatus)
    : currentStatus === expected;

  if (!ok) {
    const code = options?.code ?? StatusCodes.BAD_REQUEST;
    const entity = options?.entityName ?? 'Resource';
    const message =
      options?.message ?? `${entity} has invalid status: ${String(currentStatus)}`;
    throw new ApiError(code, message);
  }
};

/**
 * Ensure the acting user owns the entity (by owner key), otherwise throw
 * @param entity - The document to check
 * @param ownerKey - The key that holds the owner's id (e.g. 'userId')
 * @param userId - The acting user's id
 * @param options - Optional error customization
 */
type OwnerCandidate = Types.ObjectId | string | undefined | null;
const toIdStr = (v: OwnerCandidate) => (v ? v.toString() : '');

export const ensureOwnershipOrThrow = (
  entity: Record<string, unknown>,
  ownerKey: string | string[],
  userId: Types.ObjectId | string,
  options?: { message?: string; code?: number }
): void => {
  const keys = Array.isArray(ownerKey) ? ownerKey : [ownerKey];
  const userStr = userId.toString();

  const hasOwnership = keys.some((k) => {
    const value = k
      .split('.')
      .reduce((acc: any, part) => (acc ? acc[part] : undefined), entity as any);
    if (Array.isArray(value)) return value.map(toIdStr).includes(userStr);
    return toIdStr(value as OwnerCandidate) === userStr;
  });

  if (!hasOwnership) {
    const code = options?.code ?? StatusCodes.FORBIDDEN;
    const message = options?.message ?? 'You are not authorized to perform this action';
    throw new ApiError(code, message);
  }
};
