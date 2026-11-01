import NodeCache from 'node-cache';
import { logger, errorLogger } from '../../shared/logger';
import { recordCacheHit, recordCacheMiss } from '../logging/requestContext';

export type ICacheOptions = {
  ttl?: number; // Time to live in seconds
  checkperiod?: number; // Check period for expired keys
}

export class CacheHelper {
  private static instance: CacheHelper;
  private cache: NodeCache;

  private constructor(options: ICacheOptions = {}) {
    this.cache = new NodeCache({
      stdTTL: options.ttl || 600,
      checkperiod: options.checkperiod || 120,
      useClones: false,
    });
    logger.info('🔹 CacheHelper initialized');
  }

  public static getInstance(options?: ICacheOptions): CacheHelper {
    if (!CacheHelper.instance) {
      CacheHelper.instance = new CacheHelper(options);
    }
    return CacheHelper.instance;
  }

  // ------------------- Basic Cache Operations -------------------

  async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
    const start = Date.now();
    const logPrefix = `[CACHE][SET] key:${key}`;
    try {
      const ok = this.cache.set(key, value, ttl || 0);
      logger.info(
        `${logPrefix} ✅ | TTL: ${ttl || 'default'} | ⏱ ${
          Date.now() - start
        }ms`
      );
      return ok;
    } catch (err) {
      errorLogger.error(
        `${logPrefix} ❌ | ${(err as Error).message} | ⏱ ${
          Date.now() - start
        }ms`
      );
      // Fallback to memory
      const ok = this.cache.set(key, value, ttl || 0);
      return ok;
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const start = Date.now();
    const logPrefix = `[CACHE][GET] key:${key}`;
    try {
      const res = this.cache.get<T>(key);
      logger.info(
        `${logPrefix} ${res ? 'HIT ✅' : 'MISS ⚠️'} | ⏱ ${
          Date.now() - start
        }ms`
      );
      const dur = Date.now() - start;
      if (res !== undefined) recordCacheHit(dur);
      else recordCacheMiss(dur);
      return res;
    } catch (err) {
      errorLogger.error(
        `${logPrefix} ❌ | ${(err as Error).message} | ⏱ ${
          Date.now() - start
        }ms`
      );
      const fallback = this.cache.get<T>(key);
      const dur = Date.now() - start;
      if (fallback !== undefined) recordCacheHit(dur);
      else recordCacheMiss(dur);
      return fallback;
    }
  }

  async del(key: string | string[]): Promise<number> {
    const start = Date.now();
    const keys = Array.isArray(key) ? key : [key];
    const logPrefix = `[CACHE][DEL] keys:${keys.join(',')}`;

    try {
      const res = this.cache.del(keys);
      logger.info(`${logPrefix} ✅ | ⏱ ${Date.now() - start}ms`);
      return res;
    } catch (err) {
      errorLogger.error(
        `${logPrefix} ❌ | ${(err as Error).message} | ⏱ ${
          Date.now() - start
        }ms`
      );
      return this.cache.del(keys);
    }
  }

  async has(key: string): Promise<boolean> {
    const start = Date.now();
    const logPrefix = `[CACHE][HAS] key:${key}`;
    try {
      const res = this.cache.has(key);
      logger.info(
        `${logPrefix} ${res ? 'YES ✅' : 'NO ⚠️'} | ⏱ ${
          Date.now() - start
        }ms`
      );
      return res;
    } catch (err) {
      errorLogger.error(
        `${logPrefix} ❌ | ${(err as Error).message} | ⏱ ${
          Date.now() - start
        }ms`
      );
      return this.cache.has(key);
    }
  }

  async flush(): Promise<void> {
    const start = Date.now();
    const logPrefix = `[CACHE][FLUSH]`;
    try {
    } catch (err) {
      errorLogger.error(
        `${logPrefix} ❌ | ${(err as Error).message} | ⏱ ${
          Date.now() - start
        }ms`
      );
    }

    this.cache.flushAll();
    logger.info(`${logPrefix} ✅ | ⏱ ${Date.now() - start}ms`);
  }

  // ------------------- Advanced Operations -------------------

  async getOrSet<T>(
    key: string,
    fetchFunction: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const start = Date.now();
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;

    const fresh = await fetchFunction();
    await this.set(key, fresh, ttl);
    logger.info(
      `[CACHE][GETORSET] key:${key} ✅ (fresh) | ⏱ ${Date.now() - start}ms`
    );
    return fresh;
  }

  async setWithTags<T>(
    key: string,
    value: T,
    tags: string[],
    ttl?: number
  ): Promise<boolean> {
    const success = await this.set(key, value, ttl);
    if (success) {
      for (const tag of tags) {
        const tagKey = `tag:${tag}`;
        const existing = (await this.get<string[]>(tagKey)) || [];
        if (!existing.includes(key)) {
          existing.push(key);
          await this.set(tagKey, existing);
        }
      }
    }
    return success;
  }

  async invalidateByTag(tag: string): Promise<number> {
    const tagKey = `tag:${tag}`;
    const taggedKeys = (await this.get<string[]>(tagKey)) || [];
    const deletedCount = await this.del(taggedKeys);
    await this.del(tagKey);
    logger.info(`[CACHE][INVALIDATE TAG] tag:${tag} deleted:${deletedCount}`);
    return deletedCount;
  }

  // ------------------- Utility -------------------

  getStats() {
    return this.cache.getStats();
  }

  getKeys(): string[] {
    return this.cache.keys();
  }

  generateCacheKey(...parts: (string | number)[]): string {
    return parts.join(':');
  }
}
