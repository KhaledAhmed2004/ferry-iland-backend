import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import { trace } from '@opentelemetry/api';

const validateRequest =
  (schema: ZodSchema | any) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const tracer = trace.getTracer('app');

    // Extract schema name if available
    // Try to get from description first, then try to infer from stack/caller
    let schemaName = (schema as any)._def?.description;
    if (!schemaName) {
      // Try to extract from error stack to get variable name
      try {
        const stack = new Error().stack || '';

        // Try multiple patterns in order of preference
        // Pattern 1: createLoginZodSchema, createRegisterZodSchema, etc.
        let match = stack.match(/create([A-Z][a-zA-Z]+)(?:Zod)?Schema/);
        if (match) {
          schemaName = match[1] + 'Schema'; // LoginSchema, RegisterSchema
        }

        // Pattern 2: loginZodSchema, registerZodSchema (camelCase)
        if (!schemaName) {
          match = stack.match(/([a-z][a-zA-Z]+)(?:Zod)?Schema/);
          if (match) {
            // Capitalize first letter: login -> Login
            schemaName = match[1].charAt(0).toUpperCase() + match[1].slice(1) + 'Schema';
          }
        }

        // Pattern 3: LoginValidation, RegisterValidation
        if (!schemaName) {
          match = stack.match(/([A-Z][a-zA-Z]+)Validation/);
          if (match) {
            schemaName = match[1] + 'Schema';
          }
        }

        // Pattern 4: createLogin, createRegister (fallback)
        if (!schemaName) {
          match = stack.match(/create([A-Z][a-zA-Z]+)/);
          if (match) {
            schemaName = match[1] + 'Schema';
          }
        }
      } catch {}
    }

    // If still no schema name, try to infer from route path
    if (!schemaName || schemaName === 'Schema') {
      try {
        const route = req.originalUrl || req.url || '';
        // Pattern: /api/v1/auth/login or /auth/login
        const routeMatch = route.match(/\/(?:api\/v\d+\/)?([^\/\?]+)/);
        if (routeMatch) {
          const moduleName = routeMatch[1]; // e.g., "auth", "user", "payment"
          // Capitalize first letter: auth -> Auth
          schemaName = moduleName.charAt(0).toUpperCase() + moduleName.slice(1) + 'Schema';
        }
      } catch {}
    }

    schemaName = schemaName || 'Schema';

    await tracer.startActiveSpan(`Validation: ${schemaName}`, async span => {
      try {
        span.setAttribute('layer', 'Middleware > Validation');
        span.setAttribute('validation.type', 'zod');
        span.setAttribute('validation.schema', schemaName);

        // Set validation data for timeline display
        try {
          span.setAttribute('validation.data', JSON.stringify(req.body));
        } catch {}

        // Capture callsite to help timeline printer show Source when exception stack lacks paths
        try {
          const cs = new Error().stack || '';
          span.setAttribute('validation.source', cs);

          // Extract schema file location from stack trace
          // Look for validation file in stack - try multiple patterns
          let schemaFile = null;

          // Pattern 1: Full path with .validation.ts or .validation.js
          const pattern1 = cs.match(/([^\s()]+[\/\\][\w.-]+\.validation\.[tj]s):(\d+)/);
          if (pattern1) {
            schemaFile = pattern1[0];
          }

          // Pattern 2: Try without full path constraint (fallback)
          if (!schemaFile) {
            const pattern2 = cs.match(/([\w.-]+\.validation\.[tj]s):(\d+)/);
            if (pattern2) {
              schemaFile = pattern2[0];
            }
          }

          if (schemaFile) {
            // Clean up the path - extract from 'src/' onwards if present
            const srcMatch = schemaFile.match(/(src[\/\\].+)/);
            if (srcMatch) {
              schemaFile = srcMatch[1].replace(/\\/g, '/');
            }
            span.setAttribute('validation.schema.file', schemaFile);
          } else {
            // Fallback: Try to infer validation file from route path
            // e.g., /api/v1/auth/login -> src/app/modules/auth/auth.validation.ts
            const routePath = (req.route && (req.route as any).path) || '';
            const originalUrl = req.originalUrl || req.url || '';

            // Try route path first, then original URL
            const routeToMatch = routePath || originalUrl;

            // Pattern: /api/v1/auth/login or /auth/login
            const routeMatch = routeToMatch.match(/\/(?:api\/v\d+\/)?([^\/\?]+)/);
            if (routeMatch) {
              const moduleName = routeMatch[1]; // e.g., "auth"
              schemaFile = `src/app/modules/${moduleName}/${moduleName}.validation.ts`;
              span.setAttribute('validation.schema.file', schemaFile);
            } else {
              // Last resort: set a debug value
              span.setAttribute('validation.schema.file', `DEBUG: route="${routePath}", url="${originalUrl}"`);
            }
          }
        } catch {}
        span.setAttribute('http.method', req.method);
        span.setAttribute('http.route', (req.route && (req.route as any).path) || req.originalUrl || 'n/a');
        span.addEvent('VALIDATE_START');

        const isWrappedSchema = (targetSchema: any): boolean => {
          if (!targetSchema) return false;
          let target = targetSchema;
          while (target._def?.schema || target._def?.innerType || target.def?.innerType) {
            target = target._def?.schema || target._def?.innerType || target.def?.innerType;
          }
          const shape =
            target.shape ||
            (typeof target._def?.shape === 'function' ? target._def.shape() : target._def?.shape) ||
            target.def?.shape;

          if (!shape || typeof shape !== 'object') return false;
          return 'body' in shape || 'query' in shape || 'params' in shape || 'cookies' in shape;
        };

        const isWrapped = isWrappedSchema(schema);
        let result: any;

        if (isWrapped) {
          result = await schema.parseAsync({
            body: req.body,
            params: req.params,
            query: req.query,
            cookies: req.cookies,
          });
          if (result && typeof result === 'object') {
            if (result.body !== undefined) req.body = result.body;
            if (result.query !== undefined) req.query = result.query;
            if (result.params !== undefined) req.params = result.params;
          }
        } else {
          result = await schema.parseAsync(req.body);
          if (result !== undefined) {
            req.body = result;
          }
        }

        // Count validated fields
        try {
          const bodyFields = isWrapped
            ? result?.body
              ? Object.keys(result.body).length
              : 0
            : result && typeof result === 'object'
              ? Object.keys(result).length
              : 0;
          span.setAttribute('validation.fields.count', bodyFields);
        } catch {}

        span.addEvent('VALIDATE_SUCCESS');
        next();
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: 2, message: error?.message || 'Validation failed' });
        span.addEvent('ERROR');
        next(error);
      } finally {
        span.end();
      }
    });
  };

export default validateRequest;
