// Central OpenTelemetry instrumentation for jsonwebtoken
// Loads once at startup and wraps jwt.sign / jwt.verify globally.
// This keeps business helpers clean (no per-call spans in jwtHelper.ts).
import { trace } from '@opentelemetry/api';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jwt = require('jsonwebtoken');

const originalSign = jwt.sign;
const originalVerify = jwt.verify;

// Wrap sign
jwt.sign = function patchedJwtSign(...args: any[]) {
  const tracer = trace.getTracer('app');
  return tracer.startActiveSpan('JWT.sign', span => {
    try {
      const result = originalSign.apply(jwt, args);

      // Capture result message
      try {
        span.setAttribute('jwt.result.type', 'token_generated');
        span.setAttribute('jwt.result.message', 'Tokens generated');
      } catch {}

      return result;
    } catch (err) {
      try { span.recordException(err as any); } catch {}
      throw err;
    } finally {
      try { span.end(); } catch {}
    }
  });
};

// Wrap verify
jwt.verify = function patchedJwtVerify(...args: any[]) {
  const tracer = trace.getTracer('app');
  return tracer.startActiveSpan('JWT.verify', span => {
    try {
      const result = originalVerify.apply(jwt, args);

      // Capture result message
      try {
        span.setAttribute('jwt.result.type', 'token_verified');
        span.setAttribute('jwt.result.message', 'Token verified successfully');
      } catch {}

      return result;
    } catch (err) {
      try { span.recordException(err as any); } catch {}
      throw err;
    } finally {
      try { span.end(); } catch {}
    }
  });
};

export {}; // side-effect module
