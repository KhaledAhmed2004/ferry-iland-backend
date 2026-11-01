import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import { z, ZodError } from 'zod';
import globalErrorHandler from '../globalErrorHandler';
import ApiError from '../../../errors/ApiError';
import catchAsync from '../../../shared/catchAsync';
import config from '../../../config';
import { errorLogger } from '../../../shared/logger';
import { trace } from '@opentelemetry/api';

describe('globalErrorHandler (Comprehensive Verification Suite)', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let statusMock: any;
  let jsonMock: any;
  let setHeaderMock: any;
  const originalNodeEnv = config.node_env;

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    setHeaderMock = vi.fn();

    req = {
      method: 'GET',
      originalUrl: '/api/v1/users?token=secret123',
      route: { path: '/users' } as any,
      baseUrl: '/api/v1',
      headers: {},
    };

    res = {
      headersSent: false,
      status: statusMock,
      json: jsonMock,
      setHeader: setHeaderMock,
      locals: {},
    };

    next = vi.fn();
    vi.spyOn(errorLogger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    config.node_env = originalNodeEnv;
    vi.restoreAllMocks();
  });

  // ==========================================
  // PHASE A: CORE BEHAVIOR & API CONTRACT
  // ==========================================
  describe('Phase A: Core Behavior & API Contract', () => {
    it('handles ApiError with custom data and empty errorMessages', () => {
      const error = new ApiError(StatusCodes.UNPROCESSABLE_ENTITY, 'Cannot process payment', '', {
        orderId: 'ord_123',
      });

      globalErrorHandler(error, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.UNPROCESSABLE_ENTITY);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Cannot process payment',
        errorMessages: [],
        data: { orderId: 'ord_123' },
        stack: undefined,
      });
      expect(res.locals?.responsePayload).toEqual({
        success: false,
        statusCode: StatusCodes.UNPROCESSABLE_ENTITY,
        message: 'Cannot process payment',
        errorMessages: [],
      });
    });

    it('handles ApiError without data (omits data field)', () => {
      const error = new ApiError(StatusCodes.NOT_FOUND, 'User not found');

      globalErrorHandler(error, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.NOT_FOUND);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User not found',
        errorMessages: [],
        stack: undefined,
      });
      expect(jsonMock.mock.calls[0][0]).not.toHaveProperty('data');
    });

    it('handles real ZodError with nested field paths', () => {
      const schema = z.object({
        user: z.object({
          email: z.string().email(),
          age: z.number(),
        }),
      });

      let zodError: ZodError | undefined;
      try {
        schema.parse({ user: { email: 'invalid-email', age: 'twenty' } });
      } catch (err) {
        zodError = err as ZodError;
      }

      expect(zodError).toBeDefined();
      globalErrorHandler(zodError!, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
      const response = jsonMock.mock.calls[0][0];
      expect(response.success).toBe(false);
      expect(response.message).toBe('Validation Error');
      expect(Array.isArray(response.errorMessages)).toBe(true);
      expect(response.errorMessages.length).toBeGreaterThan(0);
    });

    it('handles Mongoose ValidationError correctly', () => {
      const validationError = {
        name: 'ValidationError',
        errors: {
          email: { path: 'email', message: 'Path `email` is required.' },
          role: { path: 'role', message: 'Path `role` is invalid.' },
        },
      };

      globalErrorHandler(validationError, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
      const response = jsonMock.mock.calls[0][0];
      expect(response.message).toBe('Validation Error');
      expect(response.errorMessages).toEqual([
        { path: 'email', message: 'Path `email` is required.' },
        { path: 'role', message: 'Path `role` is invalid.' },
      ]);
    });

    it('handles Mongoose CastError correctly', () => {
      const castError = {
        name: 'CastError',
        path: '_id',
        value: 'invalid_id_123',
      };

      globalErrorHandler(castError, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid ID format',
        errorMessages: [{ path: '_id', message: "Invalid value 'invalid_id_123' for field '_id'" }],
        stack: undefined,
      });
    });

    describe('MongoServerError duplicate key (code 11000)', () => {
      it('handles populated keyValue', () => {
        const error = {
          name: 'MongoServerError',
          code: 11000,
          keyValue: { email: 'duplicate@example.com' },
        };

        globalErrorHandler(error, req as Request, res as Response, next);

        expect(statusMock).toHaveBeenCalledWith(StatusCodes.CONFLICT);
        expect(jsonMock).toHaveBeenCalledWith({
          success: false,
          message: 'email already exists',
          errorMessages: [{ path: 'email', message: 'email must be unique' }],
          stack: undefined,
        });
      });

      it('safely handles empty keyValue object without undefined field', () => {
        const error = {
          name: 'MongoServerError',
          code: 11000,
          keyValue: {},
        };

        globalErrorHandler(error, req as Request, res as Response, next);

        expect(statusMock).toHaveBeenCalledWith(StatusCodes.CONFLICT);
        expect(jsonMock).toHaveBeenCalledWith({
          success: false,
          message: 'field already exists',
          errorMessages: [{ path: 'field', message: 'field must be unique' }],
          stack: undefined,
        });
      });

      it('safely handles missing keyValue without crash', () => {
        const error = {
          name: 'MongoServerError',
          code: 11000,
        };

        globalErrorHandler(error, req as Request, res as Response, next);

        expect(statusMock).toHaveBeenCalledWith(StatusCodes.CONFLICT);
        expect(jsonMock).toHaveBeenCalledWith({
          success: false,
          message: 'field already exists',
          errorMessages: [{ path: 'field', message: 'field must be unique' }],
          stack: undefined,
        });
      });
    });

    it('handles TokenExpiredError correctly', () => {
      const error = { name: 'TokenExpiredError' };

      globalErrorHandler(error, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.UNAUTHORIZED);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Session Expired',
        errorMessages: [
          {
            path: '',
            message: 'Your session has expired. Please log in again to continue.',
          },
        ],
        stack: undefined,
      });
    });

    it('handles CORS errors with static safe message and headers', () => {
      const error = new Error('Not allowed by CORS');

      globalErrorHandler(error, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.FORBIDDEN);
      expect(setHeaderMock).toHaveBeenCalledWith('X-CORS-Blocked', '1');
      expect(setHeaderMock).toHaveBeenCalledWith('Vary', 'Origin');
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'CORS blocked: origin not allowed',
        errorMessages: [
          {
            path: 'Origin',
            message: 'The request origin is not permitted by CORS policy.',
          },
        ],
        stack: undefined,
      });
    });

    it('masks internal Error messages in production', () => {
      config.node_env = 'production';
      const error = new Error('Database connection failed: password wrong');

      globalErrorHandler(error, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Something went wrong',
        errorMessages: [],
        stack: undefined,
      });
    });

    it('reveals internal Error messages and stack in development', () => {
      config.node_env = 'development';
      const error = new Error('Debug error message');

      globalErrorHandler(error, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
      const response = jsonMock.mock.calls[0][0];
      expect(response.message).toBe('Debug error message');
      expect(response.stack).toBeDefined();
      expect(response.errorMessages).toEqual([{ path: '', message: 'Debug error message' }]);
    });
  });

  // ==========================================
  // PHASE B: RESILIENCE & EDGE CASES
  // ==========================================
  describe('Phase B: Resilience, Security & Edge Cases', () => {
    it('forwards error to next() when headersSent is true', () => {
      res.headersSent = true;
      const error = new Error('Streaming failed mid-way');

      globalErrorHandler(error, req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(statusMock).not.toHaveBeenCalled();
      expect(jsonMock).not.toHaveBeenCalled();
    });

    it('safely handles throw null without crashing', () => {
      globalErrorHandler(null, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Something went wrong',
        errorMessages: [],
        stack: undefined,
      });
    });

    it('safely handles throw undefined without crashing', () => {
      globalErrorHandler(undefined, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Something went wrong',
        errorMessages: [],
        stack: undefined,
      });
    });

    it('safely handles throw string primitive without crashing', () => {
      globalErrorHandler('Fatal error string', req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Something went wrong',
        errorMessages: [],
        stack: undefined,
      });
    });

    it('safely handles arbitrary plain object throw without crashing', () => {
      globalErrorHandler({ arbitrary: 'data' }, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Something went wrong',
        errorMessages: [],
        stack: undefined,
      });
    });

    it('survives logger failures and still sends client response', () => {
      vi.spyOn(errorLogger, 'error').mockImplementation(() => {
        throw new Error('Winston disk write failure');
      });

      const error = new ApiError(StatusCodes.BAD_REQUEST, 'Client mistake');
      globalErrorHandler(error, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Client mistake',
        errorMessages: [],
        stack: undefined,
      });
    });

    it('survives OpenTelemetry span failure and still sends client response', () => {
      vi.spyOn(trace, 'getTracer').mockImplementation(() => {
        throw new Error('OTEL initialization error');
      });

      const error = new ApiError(StatusCodes.BAD_REQUEST, 'Client mistake');
      globalErrorHandler(error, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
      expect(jsonMock).toHaveBeenCalled();
    });

    it('safely falls back if ValidationError object is malformed', () => {
      const malformedValidationError = {
        name: 'ValidationError',
        errors: undefined, // Will break Object.values(error.errors) if not guarded
      };

      globalErrorHandler(malformedValidationError, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Validation Error',
        errorMessages: [],
        stack: undefined,
      });
    });

    it('safely falls back if CastError object is malformed', () => {
      const malformedCastError = {
        name: 'CastError',
        // missing path/value
      };

      globalErrorHandler(malformedCastError, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
      const response = jsonMock.mock.calls[0][0];
      expect(response.message).toBe('Invalid ID format');
    });
  });

  // ==========================================
  // PHASE C: REAL EXPRESS INTEGRATION (SUPERTEST)
  // ==========================================
  describe('Phase C: Real Express Pipeline & Async Integration (Supertest)', () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      app.use(express.json());

      // 1. Sync error route
      app.get('/test/sync-api-error', () => {
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'Sync auth failed', '', { attempt: 3 });
      });

      // 2. Async route using catchAsync
      app.get(
        '/test/async-forbidden',
        catchAsync(async () => {
          throw new ApiError(StatusCodes.FORBIDDEN, 'Async forbidden');
        }),
      );

      // 3. Async Zod validation error
      app.post(
        '/test/async-zod',
        catchAsync(async (req) => {
          z.object({ email: z.string().email() }).parse(req.body);
        }),
      );

      // 4. Non-error thrown value (throw null)
      app.get(
        '/test/throw-null',
        catchAsync(async () => {
          throw null;
        }),
      );

      // 5. Non-error thrown value (throw string)
      app.get(
        '/test/throw-string',
        catchAsync(async () => {
          throw 'Unexpected network failure string';
        }),
      );

      // 6. Generic JS Error in production vs development
      app.get(
        '/test/generic-error',
        catchAsync(async () => {
          throw new Error('Database connection timed out');
        }),
      );

      // Bind globalErrorHandler to Express pipeline
      app.use(globalErrorHandler);
    });

    it('propagates sync route error through Express pipeline to globalErrorHandler', async () => {
      const res = await request(app).get('/test/sync-api-error');

      expect(res.status).toBe(StatusCodes.UNAUTHORIZED);
      expect(res.body).toEqual({
        success: false,
        message: 'Sync auth failed',
        errorMessages: [],
        data: { attempt: 3 },
      });
    });

    it('propagates async error via catchAsync to globalErrorHandler', async () => {
      const res = await request(app).get('/test/async-forbidden');

      expect(res.status).toBe(StatusCodes.FORBIDDEN);
      expect(res.body).toEqual({
        success: false,
        message: 'Async forbidden',
        errorMessages: [],
      });
    });

    it('catches and formats Zod validation errors in async Express route', async () => {
      const res = await request(app)
        .post('/test/async-zod')
        .send({ email: 'invalid-email-address' });

      expect(res.status).toBe(StatusCodes.BAD_REQUEST);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Validation Error');
      expect(Array.isArray(res.body.errorMessages)).toBe(true);
    });

    it('safely handles throw null in real Express route without hanging or crash', async () => {
      const res = await request(app).get('/test/throw-null');

      expect(res.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(res.body).toEqual({
        success: false,
        message: 'Something went wrong',
        errorMessages: [],
      });
    });

    it('safely handles throw string primitive in real Express route', async () => {
      const res = await request(app).get('/test/throw-string');

      expect(res.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(res.body).toEqual({
        success: false,
        message: 'Something went wrong',
        errorMessages: [],
      });
    });

    it('masks internal error details in production through real Express pipeline', async () => {
      config.node_env = 'production';
      const res = await request(app).get('/test/generic-error');

      expect(res.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(res.body).toEqual({
        success: false,
        message: 'Something went wrong',
        errorMessages: [],
      });
      expect(res.body).not.toHaveProperty('stack');
    });
  });
});
