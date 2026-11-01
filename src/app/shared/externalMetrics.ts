import { recordExternalCall } from '../logging/requestContext';
import { logger, errorLogger } from '../../shared/logger';

export async function trackExternal<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const res = await fn();
    const dur = Date.now() - start;
    recordExternalCall(dur);
    logger.info(`[EXTERNAL] ${label} ✅ | ⏱ ${dur}ms`);
    return res;
  } catch (err) {
    const dur = Date.now() - start;
    recordExternalCall(dur);
    errorLogger.error(`[EXTERNAL] ${label} ❌ | ⏱ ${dur}ms | ${(err as Error)?.message || 'unknown error'}`);
    throw err;
  }
}

export function recordExternal(durationMs: number, label?: string) {
  recordExternalCall(durationMs);
  if (label) logger.info(`[EXTERNAL] ${label} ⏱ ${durationMs}ms`);
}
