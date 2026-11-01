import { ErrorRequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ZodError } from 'zod';
import { trace, SpanStatusCode, Span, context } from '@opentelemetry/api';
import config from '../../config';
import ApiError from '../../errors/ApiError';
import handleValidationError from '../../errors/handleValidationError';
import handleZodError from '../../errors/handleZodError';
import handleCastError from '../../errors/handleCastError';
import { errorLogger } from '../../shared/logger';
import { IErrorMessage } from '../../types/errors.types';

// Type Guard: ZodError checking with fallback
const isZodError = (err: unknown): err is ZodError => {
  return (
    err instanceof ZodError ||
    (typeof err === 'object' &&
      err !== null &&
      err instanceof Error &&
      err.name === 'ZodError' &&
      Array.isArray((err as any).issues))
  );
};

// Sanitized route path for telemetry/logging
const getSafeRoutePath = (req: any): string => {
  try {
    if (req.route && typeof req.route.path === 'string') {
      return req.baseUrl ? `${req.baseUrl}${req.route.path}` : req.route.path;
    }
    if (typeof req.originalUrl === 'string') {
      return req.originalUrl.split('?')[0];
    }
  } catch {}
  return 'unknown';
};

const globalErrorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  // 1. Headers already sent edge case
  if (res.headersSent) {
    return next(error);
  }

  // 2. Defensive Telemetry
  let span: Span | undefined;
  try {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan && activeSpan.isRecording()) {
      if (error instanceof Error) {
        activeSpan.recordException(error);
        activeSpan.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      } else {
        activeSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'Non-Error value thrown' });
      }
    }

    const tracer = trace.getTracer('app');
    span = tracer.startSpan('Error Handler', undefined, context.active());
    span.setAttribute('layer', 'Middleware > Error');
    span.setAttribute('http.method', req.method || 'UNKNOWN');
    span.setAttribute('http.route', getSafeRoutePath(req));
    span.addEvent('ERROR_HANDLER_START');

    if (error instanceof Error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    } else {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Non-Error value thrown' });
    }
  } catch {
    // Telemetry failure must never stop execution
  }

  // 3. Defensive Logging
  try {
    errorLogger.error('🚨 globalErrorHandler ~~ ', error);
  } catch (loggerErr) {
    console.error('Failed to log error to Winston:', loggerErr);
  }

  try {
    let statusCode: number = StatusCodes.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong';
    let errorMessages: IErrorMessage[] = [];
    let responseData: unknown = undefined;

    // 4. Safe Error Classification
    if (isZodError(error)) {
      const simplifiedError = handleZodError(error);
      statusCode = simplifiedError.statusCode;
      message = simplifiedError.message;
      errorMessages = simplifiedError.errorMessages;
    } else if (
      typeof error === 'object' &&
      error !== null &&
      (error as any).name === 'ValidationError'
    ) {
      try {
        const simplifiedError = handleValidationError(error as any);
        statusCode = simplifiedError.statusCode;
        message = simplifiedError.message;
        errorMessages = simplifiedError.errorMessages;
      } catch {
        statusCode = StatusCodes.BAD_REQUEST;
        message = 'Validation Error';
        errorMessages = [];
      }
    } else if (
      typeof error === 'object' &&
      error !== null &&
      (error as any).name === 'CastError'
    ) {
      try {
        const simplifiedError = handleCastError(error as any);
        statusCode = simplifiedError.statusCode;
        message = simplifiedError.message;
        errorMessages = simplifiedError.errorMessages;
      } catch {
        statusCode = StatusCodes.BAD_REQUEST;
        message = 'Invalid ID format';
        errorMessages = [];
      }
    } else if (
      typeof error === 'object' &&
      error !== null &&
      (error as any).name === 'MongoServerError' &&
      (error as any).code === 11000
    ) {
      statusCode = StatusCodes.CONFLICT;
      const keyValue = (error as any).keyValue;
      const keys = keyValue && typeof keyValue === 'object' ? Object.keys(keyValue) : [];
      const duplicatedField = keys.length > 0 ? keys[0] : 'field';
      message = `${duplicatedField} already exists`;
      errorMessages = [
        { path: duplicatedField, message: `${duplicatedField} must be unique` },
      ];
    } else if (
      typeof error === 'object' &&
      error !== null &&
      (error as any).name === 'TokenExpiredError'
    ) {
      statusCode = StatusCodes.UNAUTHORIZED;
      message = 'Session Expired';
      errorMessages = [
        {
          path: '',
          message: 'Your session has expired. Please log in again to continue.',
        },
      ];
    } else if (
      typeof error === 'object' &&
      error !== null &&
      ((error as any).message?.includes('Error creating UUID') ||
        (error as any).message?.includes('Inconsistent column data') ||
        (error as any).code === 'P2023')
    ) {
      const isAuthSession = Boolean(req.headers?.authorization);
      statusCode = isAuthSession ? StatusCodes.UNAUTHORIZED : StatusCodes.BAD_REQUEST;
      message = isAuthSession
        ? 'Session is invalid or using a legacy identifier. Please log in again.'
        : 'Invalid ID format: Expected a valid UUID';
      errorMessages = [
        {
          path: 'id',
          message,
        },
      ];
    } else if (
      typeof error === 'object' &&
      error !== null &&
      ((error as any).code === 'P2003' ||
        (error as any).code === '23001' ||
        (error as any).message?.includes('violates RESTRICT setting of foreign key constraint') ||
        (error as any).message?.includes('foreign key constraint'))
    ) {
      statusCode = StatusCodes.CONFLICT;
      message =
        'Cannot delete or modify record because it is referenced by other active records (such as passenger bookings or schedules).';
      errorMessages = [
        {
          path: '',
          message,
        },
      ];
    } else if (error instanceof Error && error.message === 'Not allowed by CORS') {
      statusCode = StatusCodes.FORBIDDEN;
      message = 'CORS blocked: origin not allowed';
      errorMessages = [
        {
          path: 'Origin',
          message: 'The request origin is not permitted by CORS policy.',
        },
      ];
      try {
        res.setHeader('X-CORS-Blocked', '1');
        res.setHeader('Vary', 'Origin');
      } catch {}
    } else if (error instanceof ApiError) {
      statusCode = error.statusCode;
      message = error.message;
      errorMessages = [];
      if (error.data !== undefined) {
        responseData = error.data;
      }
    } else if (error instanceof Error) {
      statusCode = StatusCodes.INTERNAL_SERVER_ERROR;
      message = config.node_env === 'development' ? error.message : 'Something went wrong';
      errorMessages =
        config.node_env === 'development' && error.message
          ? [{ path: '', message: error.message }]
          : [];
    }

    // Retain payload for requestLogger.ts
    res.locals.responsePayload = {
      success: false,
      statusCode,
      message,
      errorMessages,
    };

    // Client response
    res.status(statusCode).json({
      success: false,
      message,
      errorMessages,
      ...(responseData !== undefined ? { data: responseData } : {}),
      stack: config.node_env === 'development' && error instanceof Error ? error.stack : undefined,
    });
  } finally {
    if (span) {
      try {
        span.addEvent('FORMATTED_ERROR_RESPONSE');
        span.addEvent('ERROR_HANDLER_COMPLETE');
        span.end();
      } catch {}
    }
  }
};

export default globalErrorHandler;
