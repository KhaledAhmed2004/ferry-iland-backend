import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  parseDuration,
  KeyResolvers,
  rateLimit,
  rateLimitMiddleware,
  authLimiter,
  memory,
  resetRateLimits,
} from '../rateLimit';

describe('Rate Limiter Module & Syntactic Sugar Suite', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let headers: Record<string, any>;
  let responseStatus: number | undefined;
  let responseJson: any;

  beforeEach(() => {
    resetRateLimits();
    headers = {};
    responseStatus = undefined;
    responseJson = undefined;

    req = {
      ip: '192.168.1.100',
      path: '/test-route',
      body: {},
    };

    res = {
      setHeader: vi.fn((key: string, value: any) => {
        headers[key.toLowerCase()] = value;
        return res as Response;
      }),
      status: vi.fn((code: number) => {
        responseStatus = code;
        return res as Response;
      }),
      json: vi.fn((payload: any) => {
        responseJson = payload;
        return res as Response;
      }),
    };

    next = vi.fn();
  });

  describe('1. parseDuration utility', () => {
    it('returns raw number when already in milliseconds', () => {
      expect(parseDuration(60000)).toBe(60000);
      expect(parseDuration(0)).toBe(0);
    });

    it('correctly parses duration units (ms, s, m, h, d)', () => {
      expect(parseDuration('500ms')).toBe(500);
      expect(parseDuration('30s')).toBe(30000);
      expect(parseDuration('1m')).toBe(60000);
      expect(parseDuration('15m')).toBe(900000);
      expect(parseDuration('1h')).toBe(3600000);
      expect(parseDuration('2d')).toBe(172800000);
    });

    it('handles spacing and casing gracefully', () => {
      expect(parseDuration(' 15 M ' as any)).toBe(900000);
      expect(parseDuration('1 H' as any)).toBe(3600000);
    });

    it('throws descriptive error on invalid format', () => {
      expect(() => parseDuration('invalid' as any)).toThrowError(/Invalid duration string format/);
      expect(() => parseDuration('15x' as any)).toThrowError(/Invalid duration string format/);
    });
  });

  describe('2. KeyResolvers normalizers', () => {
    it('resolves clean IPv4 and IPv6 mapped addresses', () => {
      const mockReq1 = { ip: '::ffff:127.0.0.1' } as Request;
      expect(KeyResolvers.ip(mockReq1)).toBe('127.0.0.1');

      const mockReq2 = { ip: '10.0.0.1' } as Request;
      expect(KeyResolvers.ip(mockReq2)).toBe('10.0.0.1');

      const mockReq3 = { socket: { remoteAddress: '192.168.1.5' } } as Request;
      expect(KeyResolvers.ip(mockReq3)).toBe('192.168.1.5');
    });

    it('normalizes email (case-insensitive and trimmed)', () => {
      const mockReq = { body: { email: '  User.Test@Example.COM  ' } } as Request;
      expect(KeyResolvers.email(mockReq)).toBe('user.test@example.com');
    });

    it('returns undefined when email is missing or non-string', () => {
      expect(KeyResolvers.email({ body: {} } as Request)).toBeUndefined();
      expect(KeyResolvers.email({ body: { email: '' } } as Request)).toBeUndefined();
      expect(KeyResolvers.email({ body: { email: null } } as Request)).toBeUndefined();
    });

    it('normalizes phone number by removing spaces, hyphens and parenthesis', () => {
      const mockReq = { body: { phoneNumber: '+1 (555) 123-4567' } } as Request;
      expect(KeyResolvers.phone(mockReq)).toBe('+15551234567');

      const mockReq2 = { body: { phone: ' 01700-112233 ' } } as Request;
      expect(KeyResolvers.phone(mockReq2)).toBe('01700112233');
    });

    it('returns undefined when phone is missing or empty', () => {
      expect(KeyResolvers.phone({ body: {} } as Request)).toBeUndefined();
      expect(KeyResolvers.phone({ body: { phone: '  ' } } as Request)).toBeUndefined();
    });
  });

  describe('3. Composite rateLimit middleware', () => {
    it('allows requests within threshold and sets informative RFC headers', async () => {
      const limiter = rateLimit({
        routeName: 'test-endpoint',
        window: '1m',
        ip: 3,
      });

      await limiter(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 3);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 2);
    });

    it('blocks request when limit is exceeded with 429 and Retry-After header', async () => {
      const limiter = rateLimit({
        routeName: 'test-endpoint',
        window: '1m',
        ip: 2,
      });

      // Call 1: OK
      await limiter(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Call 2: OK
      await limiter(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(2);

      // Call 3: Exceeded -> 429
      await limiter(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(2);
      expect(responseStatus).toBe(429);
      expect(responseJson).toEqual({
        success: false,
        message: 'Too many requests, please try again later',
      });
      expect(headers['retry-after']).toBeGreaterThanOrEqual(1);
      expect(headers['x-ratelimit-remaining']).toBe(0);
    });

    it('evaluates multi-factor rules (IP + Email) atomically in a single middleware', async () => {
      const limiter = rateLimit({
        routeName: 'multi-test',
        window: '1m',
        ip: 10,
        email: 2, // Email is restricted to 2
      });

      req.body = { email: 'Target@Example.COM' };

      // 1st attempt: OK
      await limiter(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      // 2nd attempt with different casing (should hit the normalized bucket): OK
      req.body = { email: 'target@example.com' };
      await limiter(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(2);

      // 3rd attempt: Exceeds email limit -> 429
      req.body = { email: ' TARGET@EXAMPLE.COM ' };
      await limiter(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(2);
      expect(responseStatus).toBe(429);
    });

    it('gracefully skips email/phone rules when not present in request body', async () => {
      const limiter = rateLimit({
        routeName: 'optional-body-test',
        window: '1m',
        ip: 2,
        email: 2,
      });

      req.body = {}; // No email

      await limiter(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      await limiter(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(2);

      // IP limit reached on 3rd
      await limiter(req as Request, res as Response, next);
      expect(responseStatus).toBe(429);
    });
  });

  describe('4. Backward Compatibility: rateLimitMiddleware', () => {
    it('supports legacy rateLimitMiddleware signature and options', async () => {
      const legacyLimiter = rateLimitMiddleware({
        windowMs: 60000,
        max: 1,
        routeName: 'legacy-route',
      });

      await legacyLimiter(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      await legacyLimiter(req as Request, res as Response, next);
      expect(responseStatus).toBe(429);
    });

    it('supports custom keyResolver in legacy middleware', async () => {
      const legacyLimiter = rateLimitMiddleware({
        windowMs: 60000,
        max: 1,
        routeName: 'legacy-custom',
        keyResolver: r => (r.body as any)?.bookingId,
      });

      req.body = { bookingId: 'bk_123' };
      await legacyLimiter(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Next request with same bookingId -> 429
      await legacyLimiter(req as Request, res as Response, next);
      expect(responseStatus).toBe(429);

      // Request with different bookingId -> allowed
      req.body = { bookingId: 'bk_999' };
      await legacyLimiter(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe('5. High-Level Domain Presets (authLimiter)', () => {
    it('exports all standard authentication limiters', () => {
      expect(typeof authLimiter.register).toBe('function');
      expect(typeof authLimiter.login).toBe('function');
      expect(typeof authLimiter.verifyEmail).toBe('function');
      expect(typeof authLimiter.resendOtp).toBe('function');
      expect(typeof authLimiter.refreshToken).toBe('function');
      expect(typeof authLimiter.forgotPassword).toBe('function');
      expect(typeof authLimiter.resetPassword).toBe('function');
    });

    it('authLimiter.register blocks after 5 requests from same IP', async () => {
      for (let i = 0; i < 5; i++) {
        await authLimiter.register(req as Request, res as Response, next);
      }
      expect(next).toHaveBeenCalledTimes(5);

      // 6th call exceeds limit
      await authLimiter.register(req as Request, res as Response, next);
      expect(responseStatus).toBe(429);
    });
  });
});
