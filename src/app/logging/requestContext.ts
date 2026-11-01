import type { NextFunction, Request, Response } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import type { MemorySnapshot, CPUMetrics } from './performanceMetrics';

type DbQueryRecord = {
  model?: string;
  operation?: string;
  durationMs: number;
  cacheHit: boolean;
  docsExamined?: number | string;
  indexUsed?: string; // e.g., INDEX, NO_INDEX, or specific index name
  pipeline?: string; // compact summary for aggregate
  suggestion?: string; // optimization hint for slow/missing index cases
  nReturned?: number; // documents returned by the operation
  executionStage?: string; // e.g., COLLSCAN, IXSCAN, FETCH
  // 🆕 NEW: Enhanced query debugging fields (optional, non-breaking)
  filter?: string; // JSON string of query filter (sensitive data masked)
  sort?: string; // JSON string of sort fields
  projection?: string; // JSON string of selected/excluded fields
  limit?: number; // Limit value
  skip?: number; // Skip value
  callerLocation?: string; // File and line number where query was called (e.g., "user.service.ts:89")
};

type ContextStore = {
  labels: {
    controllerLabel?: string;
    serviceLabel?: string;
  };
  metrics: {
    db: { hits: number; durations: number[]; queries: DbQueryRecord[] };
    cache: { hits: number; misses: number; hitDurations: number[]; missDurations: number[] };
    external: { count: number; durations: number[] };
    // 🆕 NEW: Performance metrics (optional, non-breaking)
    performance?: {
      memoryStart?: MemorySnapshot;
      memoryEnd?: MemorySnapshot;
      cpuStart?: CPUMetrics;
      cpuEnd?: CPUMetrics;
      eventLoopSamples: number[];
    };
  };
};

const storage = new AsyncLocalStorage<ContextStore>();

// Initialize per-request context
export const requestContextInit = (req: Request, _res: Response, next: NextFunction) => {
  storage.run(
    {
      labels: {},
      metrics: {
        db: { hits: 0, durations: [], queries: [] },
        cache: { hits: 0, misses: 0, hitDurations: [], missDurations: [] },
        external: { count: 0, durations: [] },
      },
    },
    () => next()
  );
};

export const setControllerLabel = (label: string) => {
  const store = storage.getStore();
  if (!store) return;
  store.labels.controllerLabel = label;
};

export const setServiceLabel = (label: string) => {
  const store = storage.getStore();
  if (!store) return;
  store.labels.serviceLabel = label;
};

export const getLabels = () => storage.getStore()?.labels || {};

// ===== Metrics helpers =====
export const recordDbQuery = (
  durationMs: number,
  meta?: {
    model?: string;
    operation?: string;
    cacheHit?: boolean;
    docsExamined?: number | string;
    indexUsed?: string;
    pipeline?: string;
    suggestion?: string;
    nReturned?: number;
    executionStage?: string;
    // 🆕 NEW: Enhanced debugging fields (optional)
    filter?: string;
    sort?: string;
    projection?: string;
    limit?: number;
    skip?: number;
    callerLocation?: string;
  }
) => {
  const store = storage.getStore();
  if (!store) return;
  store.metrics.db.hits += 1;
  store.metrics.db.durations.push(durationMs);
  store.metrics.db.queries.push({
    model: meta?.model,
    operation: meta?.operation,
    durationMs,
    cacheHit: Boolean(meta?.cacheHit),
    docsExamined: meta?.docsExamined,
    indexUsed: meta?.indexUsed,
    pipeline: meta?.pipeline,
    suggestion: meta?.suggestion,
    nReturned: meta?.nReturned,
    executionStage: meta?.executionStage,
    // 🆕 NEW: Include enhanced fields
    filter: meta?.filter,
    sort: meta?.sort,
    projection: meta?.projection,
    limit: meta?.limit,
    skip: meta?.skip,
    callerLocation: meta?.callerLocation,
  });
};

export const recordCacheHit = (durationMs: number) => {
  const store = storage.getStore();
  if (!store) return;
  store.metrics.cache.hits += 1;
  store.metrics.cache.hitDurations.push(durationMs);
};

export const recordCacheMiss = (durationMs: number) => {
  const store = storage.getStore();
  if (!store) return;
  store.metrics.cache.misses += 1;
  store.metrics.cache.missDurations.push(durationMs);
};

export const recordExternalCall = (durationMs: number) => {
  const store = storage.getStore();
  if (!store) return;
  store.metrics.external.count += 1;
  store.metrics.external.durations.push(durationMs);
};

export const getMetrics = () => storage.getStore()?.metrics;

// 🆕 NEW: Performance metrics helpers
export const recordMemoryStart = (snapshot: MemorySnapshot) => {
  const store = storage.getStore();
  if (!store) return;
  if (!store.metrics.performance) {
    store.metrics.performance = {
      eventLoopSamples: [],
    };
  }
  store.metrics.performance.memoryStart = snapshot;
};

export const recordMemoryEnd = (snapshot: MemorySnapshot) => {
  const store = storage.getStore();
  if (!store) return;
  if (!store.metrics.performance) {
    store.metrics.performance = {
      eventLoopSamples: [],
    };
  }
  store.metrics.performance.memoryEnd = snapshot;
};

export const recordCPUStart = (metrics: CPUMetrics) => {
  const store = storage.getStore();
  if (!store) return;
  if (!store.metrics.performance) {
    store.metrics.performance = {
      eventLoopSamples: [],
    };
  }
  store.metrics.performance.cpuStart = metrics;
};

export const recordCPUEnd = (metrics: CPUMetrics) => {
  const store = storage.getStore();
  if (!store) return;
  if (!store.metrics.performance) {
    store.metrics.performance = {
      eventLoopSamples: [],
    };
  }
  store.metrics.performance.cpuEnd = metrics;
};

export const recordEventLoopSample = (lagMs: number) => {
  const store = storage.getStore();
  if (!store) return;
  if (!store.metrics.performance) {
    store.metrics.performance = {
      eventLoopSamples: [],
    };
  }
  store.metrics.performance.eventLoopSamples.push(lagMs);
};

// Helper to convert a base path segment like "auth" -> "AuthController"
// Known base path -> Controller name mapping (handles plural/singular)
const BASE_TO_CONTROLLER: Record<string, string> = {
  auth: 'AuthController',
  user: 'UserController',
  users: 'UserController',
  notification: 'NotificationController',
  notifications: 'NotificationController',
  message: 'MessageController',
  messages: 'MessageController',
  bookmark: 'BookmarkController',
  bookmarks: 'BookmarkController',
  payment: 'PaymentController',
  payments: 'PaymentController',
  chat: 'ChatController',
  chats: 'ChatController',
};

export const controllerNameFromBasePath = (baseUrl: string | undefined) => {
  if (!baseUrl) return undefined;
  const parts = baseUrl.split('/').filter(Boolean);
  const last = (parts[parts.length - 1] || '').toLowerCase();
  if (!last) return undefined;
  const direct = BASE_TO_CONTROLLER[last];
  if (direct) return direct;
  // Fallback: PascalCase + Controller
  const pascal = last
    .split('-')
    .map(seg => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
  return `${pascal}Controller`;
};
