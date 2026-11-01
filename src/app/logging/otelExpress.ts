import type { Request, Response, NextFunction } from 'express';
import { context, trace } from '@opentelemetry/api';

// Express middleware to emit helpful spans for timeline rendering
export const otelExpressMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const tracer = trace.getTracer('app');

  // Quick marker at the start of middleware chain
  try {
    tracer.startActiveSpan('Middleware Start', span => {
      span.end();
    });
  } catch {}

  const originalJson = res.json.bind(res);
  let afterJsonAt: number | undefined;

  // Wrap res.json to measure serialization
  (res as any).json = (body: any) => {
    const start = Date.now();
    try {
      return tracer.startActiveSpan('Response Serialization', span => {
        try {
          const out = originalJson(body);
          return out;
        } finally {
          const dur = Date.now() - start;
          span.setAttribute('response.serialization.ms', dur);
          span.end();
          afterJsonAt = Date.now();
        }
      });
    } catch {
      const out = originalJson(body);
      afterJsonAt = Date.now();
      return out;
    }
  };

  // On finish, record the time spent after serialization until socket flush
  res.on('finish', () => {
    try {
      const start = afterJsonAt || Date.now();
      const dur = Date.now() - start;
      tracer.startActiveSpan('🌐 HTTP Response Send', span => {
        try {
          span.setAttribute('http.status_code', res.statusCode);
          span.setAttribute('response.send.ms', dur);
          const bytes = (res as any)._contentLength || res.getHeader('content-length');
          if (bytes) span.setAttribute('response.content_length', Number(bytes));
        } finally {
          span.end();
        }
      });
    } catch {}
  });

  next();
};
