import type { Request, Response, NextFunction } from 'express';
import NodeCache from 'node-cache';
import { logger } from '../../shared/logger';

export type KeyResolver = (req: Request) => string | undefined | null;

export type DurationUnit = 'ms' | 's' | 'm' | 'h' | 'd';
export type DurationString = `${number}${DurationUnit}` | `${number} ${DurationUnit}`;
export type TimeWindow = number | DurationString;

/**
 * Shared In-Memory Cache for Rate Limiting.
 */
export const memory = new NodeCache({ stdTTL: 60, checkperiod: 30 });

/**
 * Flushes all active rate limit buckets. Useful for testing and manual resets.
 */
export const resetRateLimits = (): void => {
  memory.flushAll();
};

/**
 * Parses a duration string (e.g. '15m', '1h', '60s') into milliseconds.
 * If a number is passed, returns it as-is.
 */
export const parseDuration = (duration: TimeWindow): number => {
  if (typeof duration === 'number') return duration;

  const match = duration.trim().match(/^(\d+)\s*(ms|s|m|h|d)$/i);
  if (!match) {
    throw new Error(`Invalid duration string format: "${duration}". Supported examples: 60s, 15m, 1h, 1d.`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return value;
  }
};

/**
 * Standard Key Extractors & Canonical Normalizers
 */
export const KeyResolvers = {
  /**
   * Resolves canonical Client IP, stripping IPv6-mapped IPv4 prefix (::ffff:)
   */
  ip: (req: Request): string => {
    const rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    return rawIp.startsWith('::ffff:') ? rawIp.substring(7) : rawIp;
  },

  /**
   * Resolves, lowercases, and trims email address from request body
   */
  email: (req: Request): string | undefined => {
    const email = req.body?.email;
    return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : undefined;
  },

  /**
   * Resolves and strips all non-numeric formatting from phone number
   */
  phone: (req: Request): string | undefined => {
    const rawPhone = req.body?.phoneNumber || req.body?.phone;
    if (typeof rawPhone !== 'string' || !rawPhone.trim()) return undefined;
    return rawPhone.replace(/[\s\-()]/g, '').trim();
  },
};

/**
 * Legacy Rate Limit Options for 100% backward compatibility
 */
export type RateLimitOptions = {
  windowMs?: number;
  window?: TimeWindow;
  max: number;
  keyResolver?: KeyResolver;
  routeName?: string;
  message?: string;
};

/**
 * Multi-Rule Rate Limit Tier
 */
export interface RateLimitTier {
  key?: 'ip' | 'email' | 'phone' | (string & {});
  max: number;
  window?: TimeWindow;
  windowMs?: number;
  resolver?: KeyResolver;
}

/**
 * Composite Rate Limiter Options
 */
export interface CompositeRateLimitOptions {
  routeName: string;
  window?: TimeWindow;
  windowMs?: number;
  message?: string;
  ip?: number;
  email?: number;
  phone?: number;
  rules?: RateLimitTier[];
}

/**
 * Clean Declarative Composite Rate Limiter Middleware
 * Evaluates multiple dimensions (IP, Email, Phone, Custom) atomically in a single pass.
 */
export const rateLimit = (options: CompositeRateLimitOptions) => {
  const {
    routeName,
    window = '1m',
    windowMs,
    message = 'Too many requests, please try again later',
    rules = [],
    ip,
    email,
    phone,
  } = options;

  const defaultWindowMs = windowMs || parseDuration(window);

  const activeRules: Array<{
    name: string;
    max: number;
    windowMs: number;
    resolve: KeyResolver;
  }> = [];

  if (typeof ip === 'number') {
    activeRules.push({
      name: 'ip',
      max: ip,
      windowMs: defaultWindowMs,
      resolve: KeyResolvers.ip,
    });
  }

  if (typeof email === 'number') {
    activeRules.push({
      name: 'email',
      max: email,
      windowMs: defaultWindowMs,
      resolve: KeyResolvers.email,
    });
  }

  if (typeof phone === 'number') {
    activeRules.push({
      name: 'phone',
      max: phone,
      windowMs: defaultWindowMs,
      resolve: KeyResolvers.phone,
    });
  }

  for (const rule of rules) {
    const ruleWindowMs = rule.windowMs || (rule.window ? parseDuration(rule.window) : defaultWindowMs);
    let resolver = rule.resolver;
    if (!resolver) {
      if (rule.key === 'ip') resolver = KeyResolvers.ip;
      else if (rule.key === 'email') resolver = KeyResolvers.email;
      else if (rule.key === 'phone') resolver = KeyResolvers.phone;
      else resolver = KeyResolvers.ip;
    }
    activeRules.push({
      name: rule.key || 'custom',
      max: rule.max,
      windowMs: ruleWindowMs,
      resolve: resolver,
    });
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let lowestRemaining = Infinity;
      let lowestLimit = Infinity;

      for (const rule of activeRules) {
        const identifier = rule.resolve(req);
        if (!identifier) {
          continue;
        }

        const cacheKey = `ratelimit:${routeName}:${rule.name}:${identifier}`;
        const current = (memory.get<number>(cacheKey) || 0) + 1;
        const ttlSec = Math.ceil(rule.windowMs / 1000);
        memory.set(cacheKey, current, ttlSec);

        const remaining = Math.max(0, rule.max - current);
        if (rule.max < lowestLimit) lowestLimit = rule.max;
        if (remaining < lowestRemaining) lowestRemaining = remaining;

        if (current > rule.max) {
          logger.warn(
            `⚠️ Rate limit exceeded for [${rule.name}:${identifier}] on route [${routeName}] (${current}/${rule.max})`,
          );

          const keyTtl = memory.getTtl(cacheKey) || Date.now() + rule.windowMs;
          const retryAfterSeconds = Math.max(1, Math.ceil((keyTtl - Date.now()) / 1000));

          res.setHeader('Retry-After', retryAfterSeconds);
          res.setHeader('X-RateLimit-Limit', rule.max);
          res.setHeader('X-RateLimit-Remaining', 0);
          res.setHeader('X-RateLimit-Reset', Math.ceil(keyTtl / 1000));

          return res.status(429).json({
            success: false,
            message,
          });
        }
      }

      if (lowestLimit !== Infinity) {
        res.setHeader('X-RateLimit-Limit', lowestLimit);
        res.setHeader('X-RateLimit-Remaining', lowestRemaining);
      }

      return next();
    } catch (e) {
      logger.warn(`⚠️ RateLimit error: ${(e as Error).message}`);
      return next();
    }
  };
};

/**
 * Backward-compatible single-rule rate limiter
 */
export const rateLimitMiddleware = (options: RateLimitOptions) => {
  const { windowMs, window, max, keyResolver, routeName, message } = options;
  const effectiveWindowMs = windowMs || (window ? parseDuration(window) : 60_000);

  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = keyResolver ? keyResolver(req) : KeyResolvers.ip(req);

    if (keyResolver && !identifier) {
      return next();
    }

    const key = `ratelimit:${routeName || req.path}:${identifier}`;

    try {
      const current = (memory.get<number>(key) || 0) + 1;
      const ttlSec = Math.ceil(effectiveWindowMs / 1000);
      memory.set(key, current, ttlSec);

      if (current > max) {
        logger.warn(`⚠️ Rate limit exceeded for IP/ID: ${identifier} on route: ${routeName || req.path}`);

        const ttl = memory.getTtl(key) || Date.now() + effectiveWindowMs;
        const retryAfterSeconds = Math.max(1, Math.ceil((ttl - Date.now()) / 1000));
        res.setHeader('Retry-After', retryAfterSeconds);
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', 0);
        res.setHeader('X-RateLimit-Reset', Math.ceil(ttl / 1000));

        return res.status(429).json({
          success: false,
          message: message || 'Too many requests, please try again later',
        });
      }

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - current));
      return next();
    } catch (e) {
      logger.warn(`⚠️ RateLimit error: ${(e as Error).message}`);
      return next();
    }
  };
};

/**
 * High-Level Domain Presets for Authentication Routes
 */
export const authLimiter = {
  /**
   * Register Limiter:
   * Max 5 attempts per 1h per IP.
   * Max 3 attempts per 1h per Email.
   * Max 3 attempts per 1h per Phone number.
   */
  register: rateLimit({
    routeName: 'register',
    window: '1h',
    ip: 5,
    email: 3,
    phone: 3,
  }),

  /**
   * Verify Email OTP:
   * Max 5 attempts per 1m per IP.
   * Max 5 attempts per 15m per Email account.
   */
  verifyEmail: rateLimit({
    routeName: 'verify-email',
    rules: [
      { key: 'ip', max: 5, window: '1m' },
      { key: 'email', max: 5, window: '15m' },
    ],
  }),

  /**
   * Resend Verification OTP:
   * Max 3 requests per 1m per IP.
   * Max 1 request per 1m per Email.
   */
  resendOtp: rateLimit({
    routeName: 'resend-otp',
    rules: [
      { key: 'ip', max: 3, window: '1m' },
      { key: 'email', max: 1, window: '1m' },
    ],
  }),

  /**
   * Login Limiter:
   * Max 5 attempts per 1m per IP.
   */
  login: rateLimit({
    routeName: 'login',
    window: '1m',
    ip: 5,
  }),

  /**
   * Token Refresh Limiter:
   * Max 30 requests per 1m per IP.
   */
  refreshToken: rateLimit({
    routeName: 'refresh-token',
    window: '1m',
    ip: 30,
  }),

  /**
   * Forgot Password Limiter:
   * Max 3 requests per 1m per IP.
   * Max 3 requests per 1m per Email.
   */
  forgotPassword: rateLimit({
    routeName: 'forgot-password',
    window: '1m',
    ip: 3,
    email: 3,
  }),

  /**
   * Reset Password Limiter:
   * Max 5 attempts per 1m per IP.
   */
  resetPassword: rateLimit({
    routeName: 'reset-password',
    window: '1m',
    ip: 5,
  }),
};
