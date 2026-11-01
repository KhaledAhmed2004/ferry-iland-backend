import type { NextFunction, Request, Response } from 'express';
import colors from 'colors';
import { randomUUID } from 'crypto';
import { logger, errorLogger } from '../../shared/logger';
import {
  getLabels,
  controllerNameFromBasePath,
  getMetrics,
  recordMemoryStart,
  recordMemoryEnd,
  recordCPUStart,
  recordCPUEnd,
} from './requestContext';
import config from '../../config';
import { trace, context } from '@opentelemetry/api';
import { getTimelineTotal } from './opentelemetry';
import {
  captureMemorySnapshot,
  captureCPUUsage,
  calculateMemoryGrowth,
  calculateCPUTime,
  calculateCPUOverhead,
  getMemoryHealth,
  getCPUHealth,
  getEventLoopHealth,
  formatProgressBar,
  formatBytes,
  getHealthColor,
  getHealthEmoji,
  getHealthDescription,
  getOverallHealth,
  calculateEventLoopMetrics,
} from './performanceMetrics';

// 🗓️ Format date
const formatDate = (): string => {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  };
  const datePart = now.toLocaleString('en-US', options);
  return `${datePart} , ${now.getFullYear()}`;
};

// 🧾 Status text
const statusText = (code: number): string => {
  switch (code) {
    case 200:
      return 'OK';
    case 201:
      return 'Created';
    case 204:
      return 'No Content';
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 429:
      return 'Too Many Requests';
    case 500:
      return 'Internal Server Error';
    default:
      return String(code);
  }
};

// 🌐 Client IP
const getClientIp = (req: Request): string => {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  const ip =
    req.ip ||
    req.socket?.remoteAddress ||
    (req as any).connection?.remoteAddress;
  return ip || 'unknown';
};

// 🔒 Mask sensitive
const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'client_secret',
  'secret',
  'api_key',
  'apiKey',
]);
const maskSensitive = (value: any): any => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k) ? '********' : maskSensitive(v);
    }
    return out;
  }
  return value;
};

// 🧰 Normalize body
const normalizeBody = (req: Request): any => {
  const body: any = (req as any).body;
  if (!body) return {};
  if (Buffer.isBuffer(body)) return { raw: true, length: body.length };
  if (typeof body !== 'object') return { value: String(body) };
  return body;
};

// 🔠 Indent helper
const indentBlock = (text: string, spaces = 5): string => {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map(line => pad + line)
    .join('\n');
};

// 🎨 Format MongoDB execution stage to human-readable format
const formatExecutionStage = (stage?: string): string => {
  if (!stage) return colors.dim('Unknown');

  const stageUpper = String(stage).toUpperCase();

  // Fast operations (bright green indicator)
  if (stageUpper.includes('IXSCAN')) {
    return `${colors.green.bold('🟢')} ${colors.green.bold('IXSCAN')} ${colors.yellow('(Index Scan - Fast)')}`;
  }
  if (stageUpper.includes('COUNT_SCAN')) {
    return `${colors.green.bold('🟢')} ${colors.green.bold('COUNT_SCAN')} ${colors.yellow('(Count via Index)')}`;
  }
  if (stageUpper.includes('TEXT')) {
    return `${colors.green.bold('🟢')} ${colors.green.bold('TEXT')} ${colors.yellow('(Text Index Search)')}`;
  }
  if (stageUpper.includes('GEO') || stageUpper.includes('2DSPHERE')) {
    return `${colors.green.bold('🟢')} ${colors.green.bold('GEO_NEAR')} ${colors.yellow('(Geo Index Scan)')}`;
  }

  // Moderate operations (bright yellow indicator)
  if (stageUpper.includes('FETCH')) {
    return `${colors.yellow.bold('🟡')} ${colors.yellow.bold('FETCH')} ${colors.yellow('(Index + Document Fetch)')}`;
  }

  // Slow operations (bright red indicator - needs attention!)
  if (stageUpper.includes('COLLSCAN')) {
    return `${colors.red.bold('🔴')} ${colors.red.bold('COLLSCAN')} ${colors.yellow('(Full Collection Scan - Slow!)')}`;
  }

  // Default - unknown stage
  return `${colors.cyan.bold('ℹ️')} ${colors.cyan.bold(stage)}`;
};

// 🗄️ Render a single query in multi-line format
const renderQueryMultiLine = (q: any, index: number): string[] => {
  const lines: string[] = [];

  // Determine performance level for emoji
  const isSlow = (q?.durationMs || 0) >= 1000;
  const isModerate = (q?.durationMs || 0) >= 300 && (q?.durationMs || 0) < 1000;
  const isFast = (q?.durationMs || 0) < 300;

  const perfEmoji = isSlow ? '🐌' : isModerate ? '⚠️' : '⚡';
  const durColor = isSlow ? colors.red.bold : isModerate ? colors.yellow.bold : colors.green.bold;

  // Header: 1️⃣ User.findOne • 51ms ⚡
  const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  const numberEmoji = index < numberEmojis.length ? numberEmojis[index] : `${index + 1}️⃣`;
  const model = colors.cyan.bold(q?.model || 'Unknown');
  const operation = colors.white(q?.operation || 'query');
  const duration = durColor(`${q?.durationMs || 0}ms`);

  lines.push(`   ${numberEmoji} ${model}.${operation} • ${duration} ${perfEmoji}`);

  // Line 1: Scanned & Returned & Efficiency
  const scanned = colors.white.bold(String(q?.docsExamined || '?'));
  const returned = colors.white.bold(String(q?.nReturned !== undefined ? q.nReturned : '?'));

  // Calculate efficiency
  let efficiencyDisplay = colors.dim('n/a');
  if (q?.docsExamined && q?.nReturned !== undefined) {
    const pct = (q.nReturned / q.docsExamined) * 100;
    const pctStr = pct < 1 ? pct.toFixed(3) : pct.toFixed(2);

    if (pct >= 50) {
      efficiencyDisplay = `${colors.green.bold(pctStr + '%')} ${colors.green.bold('🟢')}`;
    } else if (pct >= 10) {
      efficiencyDisplay = `${colors.yellow.bold(pctStr + '%')} ${colors.yellow.bold('🟡')}`;
    } else {
      efficiencyDisplay = `${colors.red.bold(pctStr + '%')} ${colors.red.bold('🔴')}`;
    }
  }

  lines.push(`      ├─ ${colors.cyan('Scanned:')} ${scanned} • ${colors.cyan('Returned:')} ${returned} • ${colors.cyan('Efficiency:')} ${efficiencyDisplay}`);

  // Line 2: Index
  const indexUsed = q?.indexUsed;
  let indexDisplay;
  if (!indexUsed || indexUsed === 'NO_INDEX') {
    indexDisplay = `${colors.red.bold('❌')} ${colors.red.bold('NO_INDEX')}`;
  } else {
    indexDisplay = `${colors.green.bold('✅')} ${colors.green.bold(indexUsed)}`;
  }

  lines.push(`      ├─ ${colors.cyan('Index:')} ${indexDisplay}`);

  // Line 3: Execution Stage
  const executionStage = formatExecutionStage(q?.executionStage);
  lines.push(`      ├─ ${colors.cyan('Execution:')} ${executionStage}`);

  // Line 4: Cache
  const cacheHit = q?.cacheHit;
  const cacheDisplay = cacheHit
    ? `${colors.green.bold('✅')} ${colors.green.bold('Yes')}`
    : `${colors.dim('❌')} ${colors.dim('No')}`;

  lines.push(`      ├─ ${colors.cyan('Cache:')} ${cacheDisplay}`);

  // Line 5 (conditional): Pipeline (only for aggregate operations)
  const operationName = String(q?.operation || '').toLowerCase();
  const isAgg = operationName === 'aggregate';
  if (isAgg && q?.pipeline) {
    const pipelineStr = colors.magenta.bold(q.pipeline);
    lines.push(`      ├─ ${colors.cyan('Pipeline:')} ${pipelineStr}`);
  }

  // 🆕 NEW: Enhanced query details (filter, sort, projection, limit, skip, caller)
  // Filter
  if (q?.filter) {
    try {
      const filterObj = JSON.parse(q.filter);
      const filterDisplay = colors.yellow(JSON.stringify(filterObj));
      lines.push(`      ├─ ${colors.cyan('Filter:')} ${filterDisplay}`);
    } catch {
      lines.push(`      ├─ ${colors.cyan('Filter:')} ${colors.yellow(q.filter)}`);
    }
  }

  // Sort
  if (q?.sort) {
    try {
      const sortObj = JSON.parse(q.sort);
      const sortDisplay = colors.yellow(JSON.stringify(sortObj));
      lines.push(`      ├─ ${colors.cyan('Sort:')} ${sortDisplay}`);
    } catch {
      lines.push(`      ├─ ${colors.cyan('Sort:')} ${colors.yellow(q.sort)}`);
    }
  }

  // Projection
  if (q?.projection) {
    try {
      const projObj = JSON.parse(q.projection);
      const projDisplay = colors.yellow(JSON.stringify(projObj));
      lines.push(`      ├─ ${colors.cyan('Projection:')} ${projDisplay}`);
    } catch {
      lines.push(`      ├─ ${colors.cyan('Projection:')} ${colors.yellow(q.projection)}`);
    }
  }

  // Limit & Skip
  if (q?.limit !== undefined || q?.skip !== undefined) {
    const limitDisplay = q?.limit !== undefined ? colors.white.bold(String(q.limit)) : colors.dim('none');
    const skipDisplay = q?.skip !== undefined ? colors.white.bold(String(q.skip)) : colors.dim('0');
    lines.push(`      ├─ ${colors.cyan('Limit:')} ${limitDisplay} • ${colors.cyan('Skip:')} ${skipDisplay}`);
  }

  // Caller Location
  if (q?.callerLocation) {
    const locationDisplay = colors.green.bold(q.callerLocation);
    lines.push(`      ├─ ${colors.cyan('Called from:')} ${locationDisplay}`);
  }

  // Last line: Suggestion
  const suggestion = q?.suggestion;
  const suggestionDisplay = suggestion && suggestion !== 'n/a'
    ? `${colors.magenta.bold('💡')} ${colors.magenta.bold(suggestion)}`
    : colors.dim('n/a');

  lines.push(`      └─ ${colors.cyan('Suggestion:')} ${suggestionDisplay}`);

  return lines;
};

// 📏 File size converter
const humanFileSize = (size: number): string => {
  if (size < 1024) return size + ' B';
  const i = Math.floor(Math.log(size) / Math.log(1024));
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  return (size / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
};

// 📝 Extract files
const extractFilesInfo = (req: Request) => {
  const formatFile = (file: any) => ({
    originalname: file.originalname,
    filename: file.filename,
    mimetype: file.mimetype,
    size: humanFileSize(file.size),
  });

  if (req.file) return formatFile(req.file);
  if (req.files) {
    // Handle both array format (from .any()) and object format (from .fields())
    if (Array.isArray(req.files)) {
      // Group files by fieldname when using .any()
      const grouped: Record<string, any> = {};
      for (const file of (req.files as any[])) {
        const fieldName = (file as any).fieldname;
        if (!grouped[fieldName]) {
          grouped[fieldName] = [];
        }
        grouped[fieldName].push(formatFile(file));
      }
      
      // Convert single-item arrays to single objects for cleaner output
      const out: Record<string, any> = {};
      for (const [fieldName, files] of Object.entries(grouped)) {
        out[fieldName] = (files as any[]).length === 1 ? (files as any[])[0] : files;
      }
      return out;
    } else {
      // Handle object format (from .fields())
      const out: Record<string, any> = {};
      for (const [key, value] of Object.entries(req.files as Record<string, any>)) {
        if (Array.isArray(value)) out[key] = value.map(formatFile);
        else out[key] = formatFile(value);
      }
      return out;
    }
  }
  return undefined;
};

// 🧭 Detect Stripe webhook requests
const WEBHOOK_PATH = '/api/v1/payments/webhook';
const isStripeWebhook = (req: Request): boolean => {
  const pathMatch = req.originalUrl?.includes(WEBHOOK_PATH);
  const sigPresent = Boolean(req.headers['stripe-signature']);
  const ua = String(req.headers['user-agent'] || '');
  const uaStripe = ua.startsWith('Stripe/');
  return Boolean(pathMatch || sigPresent || uaStripe);
};

// 🧾 Build minimal webhook context for global logs (no secrets)
const getWebhookLogContext = (req: Request) => {
  const contentType = String(req.headers['content-type'] || '');
  const ua = String(req.headers['user-agent'] || '');
  const sigHeader = req.headers['stripe-signature'];
  const body: any = (req as any).body;
  const rawLength = Buffer.isBuffer(body)
    ? body.length
    : typeof body === 'string'
      ? Buffer.byteLength(body)
      : undefined;

  return {
    timestamp: new Date().toISOString(),
    headers: {
      'stripe-signature': sigHeader ? 'Present' : 'Missing',
      'content-type': contentType,
      'user-agent': ua,
    },
    bodySize: rawLength,
  };
};

// 🧪 Safely parse Stripe event from raw body without mutating req.body
const parseStripeEventSafe = (req: Request): any | undefined => {
  const body: any = (req as any).body;
  try {
    if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8'));
    if (typeof body === 'string') return JSON.parse(body);
    if (body && typeof body === 'object') return body;
  } catch {
    return undefined;
  }
  return undefined;
};

const getEventSummary = (evt: any) => ({
  type: evt?.type,
  id: evt?.id,
  created:
    typeof evt?.created === 'number'
      ? new Date(evt.created * 1000).toISOString()
      : evt?.created,
  livemode: Boolean(evt?.livemode),
});

const getPaymentIntentLogDetails = (evt: any) => {
  const obj = evt?.data?.object || {};
  const metadata = obj?.metadata && typeof obj.metadata === 'object' ? obj.metadata : undefined;
  return {
    paymentIntentId: obj?.id,
    amount: obj?.amount,
    amount_capturable: obj?.amount_capturable,
    currency: obj?.currency,
    status: obj?.status,
    metadata,
  };
};

// 🎛️ Try to derive an Express handler/controller label
const deriveHandlerLabel = (req: Request, res: Response): string | undefined => {
  const fromLocals = (res.locals as any)?.handlerName;
  if (fromLocals && typeof fromLocals === 'string') return fromLocals;

  // Attempt to infer from Express route stack
  const route: any = (req as any).route;
  if (route?.stack && Array.isArray(route.stack)) {
    const names = route.stack
      .map((layer: any) => (layer && layer.handle && layer.handle.name) || '')
      .filter((n: string) => Boolean(n));
    if (names.length) return names[names.length - 1];
  }

  // Fallback to route path if available
  if (route?.path) return `${req.method} ${route.path}`;
  return undefined;
};

// 🧾 Main Logger
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const start = Date.now();
  const requestId = (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']) || randomUUID();
  res.setHeader('X-Request-Id', requestId);
  (res.locals as any).requestId = requestId;

  // 🆕 NEW: Capture performance baseline (memory, CPU)
  try {
    if (config.tracing?.performance?.enabled) {
      if (config.tracing.performance.captureMemory) {
        recordMemoryStart(captureMemorySnapshot());
      }
      if (config.tracing.performance.captureCPU) {
        recordCPUStart(captureCPUUsage());
      }
    }
  } catch {
    // Silent failure - won't affect request
  }

  res.on('finish', () => {
    const ms = Date.now() - start;
    let processedMs = ms;
    try {
      const span = trace.getSpan(context.active());
      const tid = span?.spanContext().traceId;
      const total = tid ? getTimelineTotal(tid) : undefined;
      if (typeof total === 'number' && total > 0) processedMs = total;
    } catch {}
    const status = res.statusCode;
    const statusMsg = statusText(status);
    // Silence console logs for observability endpoints to avoid terminal spam
    const isObservabilityRoute = Boolean(req.originalUrl?.includes('/api/v1/observability'));

    const details = {
      params: req.params || {},
      query: req.query || {},
      body: normalizeBody(req),
      files: extractFilesInfo(req),
    };
    const maskedDetails = maskSensitive(details);

    // 🎨 Method color
    const methodColor = (() => {
      switch (req.method) {
        case 'GET':
          return colors.bgGreen.black.bold(` ${req.method} `);
        case 'POST':
          return colors.bgBlue.white.bold(` ${req.method} `);
        case 'PUT':
          return colors.bgYellow.black.bold(` ${req.method} `);
        case 'PATCH':
          return colors.bgMagenta.white.bold(` ${req.method} `);
        case 'DELETE':
          return colors.bgRed.white.bold(` ${req.method} `);
        default:
          return colors.bgWhite.black.bold(` ${req.method} `);
      }
    })();

    const routeColor = colors.cyan.bold(req.originalUrl);
    const ipColor = colors.blue.bold(` ${getClientIp(req)} `);

    // 🎨 Status color
    const statusColor = (() => {
      if (status >= 500) return colors.bgRed.white.bold;
      if (status >= 400) return colors.bgRed.white.bold;
      if (status >= 300) return colors.bgYellow.black.bold;
      return colors.bgGreen.black.bold;
    })();

    // 🎨 Message text color only background
    const messageBg = (() => {
      if (status >= 500) return colors.bgRed.white;
      if (status >= 400) return colors.bgRed.white;
      if (status >= 300) return colors.bgYellow.black;
      return colors.bgGreen.black;
    })();

    const responsePayload = res.locals.responsePayload || {};
    const responseMessage = responsePayload.message || '';
    const responseErrors = responsePayload.errorMessages;

    // 🧑‍💻 Auth context (if available)
    const authCtx = (() => {
      const u: any = (req as any).user;
      if (!u) return undefined;
      return {
        id: u.userId || u.id || u._id,
        email: u.email,
        role: u.role,
      };
    })();

    // 🛰️ Client context
    const ua = String(req.headers['user-agent'] || '');
    const referer = String(req.headers['referer'] || req.headers['referrer'] || '');
    const contentType = String(req.headers['content-type'] || '');
    const handlerLabel = deriveHandlerLabel(req, res);
    // Read dynamic labels from AsyncLocalStorage (if any)
    const ctxLabels = getLabels();
    let controllerLabel: string | undefined = (res.locals as any)?.controllerLabel || ctxLabels.controllerLabel || (res.locals as any)?.handlerName;
    const serviceLabel: string | undefined = (res.locals as any)?.serviceLabel || ctxLabels.serviceLabel || (res.locals as any)?.serviceName;

    // If controller label is missing, derive from base path + handler
    if (!controllerLabel) {
      const baseCtrl = controllerNameFromBasePath(req.baseUrl);
      if (baseCtrl && handlerLabel) {
        controllerLabel = `${baseCtrl}.${handlerLabel}`;
      } else if (baseCtrl) {
        controllerLabel = baseCtrl;
      }
    }

    const lines: string[] = [];
    lines.push(colors.blue.bold(`[${formatDate()}]  🧩 Req-ID: ${requestId}`));
    lines.push(`📥 Request: ${methodColor} ${routeColor} from IP:${ipColor}`);
    lines.push(colors.blue(`     🛰️ Client: ua="${ua}" referer="${referer || 'n/a'}" ct="${contentType || 'n/a'}"`));
    // Enriched device/OS/browser info (if available)
    const info: any = (res.locals as any)?.clientInfo;
    if (info) {
      const osLabel = info.osFriendly || info.os;
      const osRaw = info.osVersion ? ` (${info.osVersion})` : '';
      const model = info.deviceModel ? `, Model: ${info.deviceModel}` : '';
      const arch = info.arch ? `, Arch: ${info.arch}` : '';
      const bits = info.bitness ? `, ${info.bitness}-bit` : '';
      const br = info.browser ? `, Browser: ${info.browser}${info.browserVersion ? ' ' + info.browserVersion : ''}` : '';
      lines.push(colors.blue(`     💻 Device: ${info.deviceType}, OS: ${osLabel}${osRaw}${model}${arch}${bits}${br}`));
    }
    if (controllerLabel || serviceLabel) {
      const parts: string[] = [];
      if (controllerLabel) parts.push(`controller: ${controllerLabel}`);
      if (serviceLabel) parts.push(`service: ${serviceLabel}`);
      lines.push(colors.blue(`     🎛️ Handler: ${parts.join(' ')}`));
    } else if (handlerLabel) {
      lines.push(colors.blue(`     🎛️ Handler: ${handlerLabel}`));
    }
    if (authCtx) {
      lines.push(colors.gray(`     👤 Auth: id="${authCtx.id || 'n/a'}" email="${authCtx.email || 'n/a'}" role="${authCtx.role || 'n/a'}"`));
    }

    // 🔔 Stripe webhook request context (global)
    if (isStripeWebhook(req)) {
      lines.push(colors.yellow('     🔔 Stripe webhook request context:'));
      lines.push(colors.white(indentBlock(JSON.stringify(getWebhookLogContext(req), null, 2))));

      // ✅ Signature verification status from controller
      const sigVerified = (res.locals as any)?.webhookSignatureVerified;
      const sigError = (res.locals as any)?.webhookSignatureError;
      if (sigVerified === true) {
        lines.push(colors.green('     ✅ Webhook signature verified successfully'));
      } else if (sigVerified === false) {
        lines.push(colors.red(`     ❌ Webhook signature verification failed: ${sigError || 'unknown error'}`));
      }

      // 🔐 Masked webhook secret preview
      const secretPreview = (res.locals as any)?.webhookSecretPreview || (process.env.STRIPE_WEBHOOK_SECRET ? String(process.env.STRIPE_WEBHOOK_SECRET).substring(0, 10) + '...' : undefined);
      if (secretPreview) {
        lines.push(colors.blue(`     🔐 Webhook secret configured: ${secretPreview}`));
      }

      const evt = parseStripeEventSafe(req);
      if (evt && evt.object === 'event' && evt.type) {
        lines.push(colors.yellow('     📨 Received webhook event:'));
        lines.push(colors.white(indentBlock(JSON.stringify(getEventSummary(evt), null, 2))));

        const type = evt.type as string;
        if (type === 'payment_intent.amount_capturable_updated') {
          lines.push(colors.yellow('     💳 Amount capturable updated:'));
          lines.push(colors.white(indentBlock(JSON.stringify(getPaymentIntentLogDetails(evt), null, 2))));
        } else if (type === 'payment_intent.succeeded') {
          lines.push(colors.yellow('     💰 Processing payment succeeded:'));
          lines.push(colors.white(indentBlock(JSON.stringify(getPaymentIntentLogDetails(evt), null, 2))));
        } else if (type === 'payment_intent.payment_failed') {
          lines.push(colors.yellow('     ❌ Payment failed details:'));
          lines.push(colors.white(indentBlock(JSON.stringify(getPaymentIntentLogDetails(evt), null, 2))));
        }
      }
    }

    if (config.node_env === 'development') {
      lines.push(colors.yellow('     🔎 Request details:'));
      lines.push(
        colors.white(indentBlock(JSON.stringify(maskedDetails, null, 2)))
      );
    }

    const respLabel = status >= 400 ? '❌ Response sent:' : '📤 Response sent:';
    const respSizeHeader = res.getHeader('Content-Length');
    const respSize = typeof respSizeHeader === 'string' ? respSizeHeader : Array.isArray(respSizeHeader) ? respSizeHeader[0] : (respSizeHeader as any);
    lines.push(`${respLabel} ${statusColor(` ${status} ${statusMsg} `)} ${colors.blue(respSize ? `(size: ${respSize} bytes)` : '')}`);

    // 💬 Message with bg only on message text
    if (responseMessage) {
      lines.push(`💬 Message: ${messageBg(` ${responseMessage} `)}`);
    }

    if (
      responseErrors &&
      Array.isArray(responseErrors) &&
      responseErrors.length
    ) {
      lines.push(colors.red('📌 Details:'));
      lines.push(
        colors.white(indentBlock(JSON.stringify(responseErrors, null, 2)))
      );
    }

    // 🆕 NEW: Capture performance end state (memory, CPU)
    try {
      if (config.tracing?.performance?.enabled) {
        if (config.tracing.performance.captureMemory) {
          recordMemoryEnd(captureMemorySnapshot());
        }
        if (config.tracing.performance.captureCPU) {
          recordCPUEnd(captureCPUUsage());
        }
      }
    } catch {
      // Silent failure
    }

    // 📊 Metrics block (DB, Cache, External) with detailed DB categories
    try {
      const m = getMetrics();
      if (m) {
        const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
        const max = (arr: number[]) => (arr.length ? Math.max(...arr) : 0);

        const dbHits = m.db.hits;
        const dbAvg = avg(m.db.durations);
        const dbSlow = max(m.db.durations);

        // Build detailed DB metrics output
        lines.push(' ----------------------------------------------------');
        lines.push(colors.bold(' 🧮 DB Metrics'));
        lines.push(colors.magenta(`    • Hits            : ${dbHits}${dbHits > 0 ? ' ✅' : ''}`));
        lines.push(colors.magenta(`    • Avg Query Time  : ${dbAvg}ms ⏱️`));
        lines.push(colors.magenta(`    • Slowest Query   : ${dbSlow}ms ${dbSlow >= 1000 ? '🐌' : dbSlow >= 300 ? '⏱️' : '⚡'}`));

        const queries = (m.db as any).queries || [];
        const byCat = {
          fast: queries.filter((q: any) => q?.durationMs < 300),
          moderate: queries.filter((q: any) => q?.durationMs >= 300 && q?.durationMs < 1000),
          slow: queries.filter((q: any) => q?.durationMs >= 1000),
        };

        const fmtDocs = (val: any): string => {
          if (val === null || val === undefined) return 'n/a';
          if (typeof val === 'string') return val;
          if (typeof val !== 'number') return 'n/a';
          const n = val;
          if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M 😱`;
          if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
          return String(n);
        };
        const fmtIndex = (val: any): string => {
          if (!val) return 'n/a';
          const s = String(val).toUpperCase();
          if (s === 'NO_INDEX') return '❌ NO_INDEX';
          if (s === 'INDEX') return '✅ INDEX';
          return `✅ ${String(val)}`;
        };
        const deriveSuggestion = (q: any): string => {
          const slow = q?.durationMs >= 1000;
          const noIdx = String(q?.indexUsed || '').toUpperCase() === 'NO_INDEX';
          const isAgg = String(q?.operation).toLowerCase() === 'aggregate';
          if (!slow && !noIdx) return 'n/a';
          if (isAgg && typeof q?.pipeline === 'string') {
            const m = /\$match\(([^=]+)=/.exec(q.pipeline);
            if (m && m[1]) return `createIndex({ ${m[1]}: 1 })`;
          }
          return 'add indexes on frequent filter fields';
        };

        const deriveScanEfficiency = (q: any): string => {
          const docsExamined = typeof q?.docsExamined === 'number' ? q.docsExamined : undefined;
          const nReturned = typeof q?.nReturned === 'number' ? q.nReturned : undefined;
          if (!docsExamined || docsExamined <= 0 || !nReturned || nReturned < 0) return 'n/a';
          const pct = (nReturned / docsExamined) * 100;
          const pctStr = pct < 0.01 ? pct.toFixed(3) : pct < 1 ? pct.toFixed(3) : pct.toFixed(2);
          const label = pct >= 50 ? '🟢 (Excellent)' : pct >= 10 ? '⚡ (Good)' : '⚠️ (Poor)';
          return `${pctStr}% ${label}`;
        };

        const renderQueryLine = (q: any): string => {
          const isAgg = String(q?.operation).toLowerCase() === 'aggregate';
          const pipelineStr = isAgg ? q?.pipeline || 'n/a' : 'n/a';
          const suggestion = deriveSuggestion(q);
          const nReturnedStr = typeof q?.nReturned === 'number' ? String(q.nReturned) : 'n/a';
          const scanEff = deriveScanEfficiency(q);
          const execStage = q?.executionStage || 'n/a';
          return colors.gray(
            ` - Model: ${q.model || 'n/a'} | Operation: ${q.operation || 'n/a'} | Duration: ${q.durationMs}ms | Docs Examined: ${fmtDocs(q.docsExamined)} | Index Used: ${fmtIndex(q.indexUsed)} | Pipeline: ${pipelineStr} | Cache Hit: ${q.cacheHit ? '✅' : '❌'} | Suggestion: ${suggestion} | nReturned: ${nReturnedStr} | Scan Efficiency: ${scanEff} | Execution Stage: ${execStage}`
          );
        };

        lines.push(colors.green.bold(`⚡ FAST QUERIES (< 300ms) — ${byCat.fast.length} found`));
        lines.push('');
        if (!byCat.fast.length) {
          lines.push(colors.dim('   └─ None'));
        } else {
          byCat.fast.forEach((q: any, index: number) => {
            const queryLines = renderQueryMultiLine(q, index);
            lines.push(...queryLines);

            // Add blank line between queries (except after last one)
            if (index < byCat.fast.length - 1) {
              lines.push('');
            }
          });
        }

        lines.push('');
        lines.push(colors.yellow.bold(`⏱️  MODERATE QUERIES (300-999ms) — ${byCat.moderate.length} found`));
        if (!byCat.moderate.length) {
          lines.push(colors.dim('   └─ None'));
        } else {
          lines.push('');
          byCat.moderate.forEach((q: any, index: number) => {
            const queryLines = renderQueryMultiLine(q, index);
            lines.push(...queryLines);

            if (index < byCat.moderate.length - 1) {
              lines.push('');
            }
          });
        }

        lines.push('');
        lines.push(colors.red.bold(`🐌 SLOW QUERIES (≥ 1000ms) — ${byCat.slow.length} found`));
        if (!byCat.slow.length) {
          lines.push(colors.dim('   └─ None ✨'));
        } else {
          lines.push('');
          byCat.slow.forEach((q: any, index: number) => {
            const queryLines = renderQueryMultiLine(q, index);
            lines.push(...queryLines);

            if (index < byCat.slow.length - 1) {
              lines.push('');
            }
          });
        }

        const cacheHits = m.cache.hits;
        const cacheMisses = m.cache.misses;
        const cacheTotal = cacheHits + cacheMisses;
        const cacheHitRatio = cacheTotal ? Math.round((cacheHits / cacheTotal) * 100) : 0;

        const extCount = m.external.count;
        const extAvg = avg(m.external.durations);
        const extSlow = max(m.external.durations);

        // Derive total request cost
        let cost: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
        if (dbHits >= 8 || dbAvg >= 120 || dbSlow >= 350 || extAvg >= 400 || extSlow >= 500) cost = 'HIGH';
        else if (dbHits >= 4 || extCount >= 1) cost = 'MEDIUM';

        lines.push(colors.bold(' 🗄️ Cache Metrics'));
        lines.push(colors.magenta(`    • Hits            : ${cacheHits}`));
        lines.push(colors.magenta(`    • Misses          : ${cacheMisses}`));
        lines.push(colors.magenta(`    • Hit Ratio       : ${cacheHitRatio}%`));

        lines.push(colors.bold(' 🌐 External API Calls'));
        lines.push(colors.magenta(`    • Count           : ${extCount}`));
        lines.push(colors.magenta(`    • Avg Response    : ${extAvg}ms`));
        lines.push(colors.magenta(`    • Slowest Call    : ${extSlow}ms`));

        const costColor = cost === 'HIGH' ? colors.bgRed.white.bold : cost === 'MEDIUM' ? colors.bgYellow.black.bold : colors.bgGreen.black.bold;
        lines.push(' ----------------------------------------------------');
        lines.push(`${colors.bold(' 📊 Total Request Cost ')}: ${costColor(` ${cost} `)} ${cost === 'HIGH' ? '⚠️' : cost === 'MEDIUM' ? '⚠️' : '✅'}`);
      }
    } catch {}

    // 🆕 NEW: Performance Metrics Display
    try {
      const m = getMetrics();
      if (
        config.tracing?.performance?.enabled &&
        m?.performance &&
        (m.performance.memoryStart || m.performance.cpuStart)
      ) {
        const perf = m.performance;
        const thresholds = config.tracing.performance.thresholds;

        lines.push('');
        lines.push(colors.cyan.bold(' 📊 PERFORMANCE METRICS'));
        lines.push(' ----------------------------------------------------');

        // Memory Section
        if (perf.memoryStart && perf.memoryEnd) {
          const growthMB = calculateMemoryGrowth(perf.memoryStart, perf.memoryEnd);
          const memHealth = getMemoryHealth(growthMB, thresholds.memory);
          const memColor = getHealthColor(memHealth);
          const memEmoji = getHealthEmoji(memHealth);
          const memBar = formatProgressBar(Math.abs(growthMB), 100, 10);

          lines.push(colors.bold(' 💾 Memory'));
          lines.push(colors.magenta(`    • Heap Start      : ${formatBytes(perf.memoryStart.heapUsed)}`));
          lines.push(colors.magenta(`    • Heap End        : ${formatBytes(perf.memoryEnd.heapUsed)}`));

          // Context note for high memory growth
          let memoryNote = '';
          if (growthMB > 50) {
            const hasFiles = req.files && Object.keys(req.files).length > 0;
            const isCryptoOperation =
              req.originalUrl?.includes('/auth/') ||
              req.originalUrl?.includes('/login') ||
              req.originalUrl?.includes('/register') ||
              req.originalUrl?.includes('/reset-password');

            if (hasFiles) {
              memoryNote = colors.gray(' (file upload allocates buffers - normal)');
            } else if (isCryptoOperation) {
              memoryNote = colors.gray(' (bcrypt allocates ~30-40MB - normal for auth)');
            } else {
              memoryNote = colors.gray(' (consider if sustained across multiple requests)');
            }
          }

          lines.push(
            memColor(
              `    • Growth          : ${memBar} ${growthMB >= 0 ? '+' : ''}${growthMB} MB [${memHealth}] ${memEmoji}${memoryNote}`
            )
          );
          lines.push(colors.magenta(`    • RSS             : ${formatBytes(perf.memoryEnd.rss)}`));
          lines.push(
            memColor(`    • Status          : ${memHealth} - ${getHealthDescription(memHealth, 'memory')} ${memEmoji}`)
          );
        }

        // CPU Section
        if (perf.cpuStart && perf.cpuEnd) {
          const cpuTime = calculateCPUTime(perf.cpuStart, perf.cpuEnd);
          const cpuOverhead = calculateCPUOverhead(cpuTime.totalMs, processedMs);
          const cpuHealth = getCPUHealth(cpuOverhead, thresholds.cpu);
          const cpuColor = getHealthColor(cpuHealth);
          const cpuEmoji = getHealthEmoji(cpuHealth);
          const cpuBar = formatProgressBar(cpuOverhead, 100, 10);

          lines.push(colors.bold(' ⚡ CPU'));
          lines.push(colors.magenta(`    • User Time       : ${cpuTime.userMs}ms`));
          lines.push(colors.magenta(`    • System Time     : ${cpuTime.systemMs}ms`));
          lines.push(colors.magenta(`    • Total           : ${cpuTime.totalMs}ms`));

          // Context note for high CPU overhead (>100%)
          let cpuOverheadNote = '';
          if (cpuOverhead > 100) {
            const isCryptoOperation =
              req.originalUrl?.includes('/auth/') ||
              req.originalUrl?.includes('/login') ||
              req.originalUrl?.includes('/register') ||
              req.originalUrl?.includes('/reset-password');

            const isFileOperation =
              req.originalUrl?.includes('/upload') ||
              Boolean(req.files && Object.keys(req.files).length > 0);

            if (isCryptoOperation) {
              cpuOverheadNote = colors.gray(' (bcrypt/JWT uses thread pool - normal)');
            } else if (isFileOperation) {
              cpuOverheadNote = colors.gray(' (file processing on thread pool - normal)');
            } else {
              cpuOverheadNote = colors.gray(' (multi-core async operation)');
            }
          }

          lines.push(
            cpuColor(
              `    • Overhead        : ${cpuBar} ${cpuOverhead.toFixed(1)}% of request [${cpuHealth}] ${cpuEmoji}${cpuOverheadNote}`
            )
          );
          lines.push(
            cpuColor(`    • Status          : ${cpuHealth} - ${getHealthDescription(cpuHealth, 'cpu')} ${cpuEmoji}`)
          );
        }

        // Event Loop Section
        if (perf.eventLoopSamples && perf.eventLoopSamples.length > 0) {
          const loopMetrics = calculateEventLoopMetrics(perf.eventLoopSamples);
          const loopHealth = getEventLoopHealth(loopMetrics.avgLag, thresholds.eventLoop);
          const loopColor = getHealthColor(loopHealth);
          const loopEmoji = getHealthEmoji(loopHealth);
          const loopBar = formatProgressBar(loopMetrics.avgLag, 50, 10);

          lines.push(colors.bold(' 🔄 Event Loop'));
          lines.push(
            loopColor(`    • Avg Lag         : ${loopBar} ${loopMetrics.avgLag.toFixed(1)}ms [${loopHealth}] ${loopEmoji}`)
          );
          lines.push(colors.magenta(`    • Peak Lag        : ${loopMetrics.peakLag.toFixed(1)}ms`));
          lines.push(colors.magenta(`    • Samples         : ${loopMetrics.sampleCount}`));
          lines.push(
            loopColor(
              `    • Status          : ${loopHealth} - ${getHealthDescription(loopHealth, 'eventLoop')} ${loopEmoji}`
            )
          );
        }

        // Overall Health Summary
        if (perf.memoryStart && perf.memoryEnd && perf.cpuStart && perf.cpuEnd) {
          const growthMB = calculateMemoryGrowth(perf.memoryStart, perf.memoryEnd);
          const cpuTime = calculateCPUTime(perf.cpuStart, perf.cpuEnd);
          const cpuOverhead = calculateCPUOverhead(cpuTime.totalMs, processedMs);
          const loopMetrics = perf.eventLoopSamples?.length
            ? calculateEventLoopMetrics(perf.eventLoopSamples)
            : { avgLag: 0 } as any;

          const memHealth = getMemoryHealth(growthMB, thresholds.memory);
          const cpuHealth = getCPUHealth(cpuOverhead, thresholds.cpu);
          const loopHealth = getEventLoopHealth(loopMetrics.avgLag, thresholds.eventLoop);

          const overall = getOverallHealth(memHealth, cpuHealth, loopHealth);
          const overallColor = overall.emoji === '✅' ? colors.green.bold : overall.emoji === '⚠️' ? colors.yellow.bold : overall.emoji === '🟠' ? colors.magenta.bold : colors.red.bold;

          lines.push(' ----------------------------------------------------');
          lines.push(
            overallColor(` 🧠 Overall Health: ${overall.status} - ${overall.message} ${overall.emoji}`)
          );
        }
      }
    } catch {}

    // ⏱️ Duration with thresholds and category label
    const durColor = processedMs >= 1000 ? colors.bgRed.white.bold : processedMs >= 300 ? colors.bgYellow.black.bold : colors.bgGreen.black.bold;
    const categoryLabel = processedMs >= 1000 ? 'Slow: >= 1000ms' : processedMs >= 300 ? 'Moderate: 300–999ms' : 'Fast: < 300ms';
    lines.push(`${durColor(` ⏱️ Processed in ${processedMs}ms `)} ${colors.blue(`[ ${categoryLabel} ]`)}`);

    const formatted = lines.join('\n');
    if (!isObservabilityRoute) {
      if (status >= 400) errorLogger.error(formatted);
      else logger.info(formatted);
    }

    // Observability log buffer removed
  });

  next();
};

// (removed) Misplaced Stripe signature log block — now handled inside formatted logger output
