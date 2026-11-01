import { logger, errorLogger } from '../../shared/logger';

// Allowed origins for CORS
export const allowedOrigins: string[] = [
  'http://localhost:3000',
  'https://ferry-iland-frontend.vercel.app',
  'https://island-hop-web-pi.vercel.app',
  'http://island-hop-web-pi.vercel.app',
  'https://dashboard.ekkali.app',
  'http://dashboard.ekkali.app',
  'https://api.ekkali.app',
  'http://api.ekkali.app',
  'https://moeb-dashboard.vercel.app',
  'http://localhost:3001',
  'http://localhost:5174',
  'https://task-titans-admin-orcin.vercel.app',
  'http://localhost:5173',
  'http://localhost:5175',
  'https://task-titans-six.vercel.app',
  'https://task-titans-admin.vercel.app',
  'https://tier-elected-proc-cumulative.trycloudflare.com',
  'https://directory-supplements-adapter-designs.trycloudflare.com',
  // Add common development origins
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://localhost:3002',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  // Local backend preview ports for static test pages
  'http://localhost:5000',
  'http://localhost:3001',
  'http://localhost:5001',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5001',
  'http://10.10.7.33:5001',
  // Dev server alternate ports
  'http://localhost:5003',
  'http://127.0.0.1:5003',
  'http://localhost:5005',
  'http://127.0.0.1:5005',
];

// Enable with env CORS_DEBUG=true or CORS_DEBUG=1
const CORS_DEBUG =
  String(process.env.CORS_DEBUG || '').toLowerCase() === 'true' ||
  process.env.CORS_DEBUG === '1';

const corsLogMap = new Map<string, number>();
const CORS_LOG_WINDOW_MS = 60_000; // log at most once per origin per minute

export const isOriginAllowed = (origin?: string): boolean => {
  if (!origin) return true; // allow non-browser clients (Postman/mobile)
  return allowedOrigins.includes(origin);
};

// Rate-limited CORS decision logging
export const maybeLogCors = (
  origin: string | undefined,
  allowed: boolean,
): void => {
  if (!CORS_DEBUG) return;
  const key = origin || 'no-origin';
  const now = Date.now();
  const last = corsLogMap.get(key) || 0;
  if (now - last < CORS_LOG_WINDOW_MS) return;
  corsLogMap.set(key, now);
  if (!origin) {
    logger.info(
      'CORS allow: request without Origin header (Postman/mobile/native)',
    );
    return;
  }
  if (allowed) logger.info(`CORS allow: ${origin}`);
  else errorLogger.warn(`CORS block: ${origin}`);
};
