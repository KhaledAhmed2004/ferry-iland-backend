/*
  OpenTelemetry bootstrap with a custom TimelineConsoleExporter.
  - Auto-instruments Node/HTTP/Express/MongoDB, etc.
  - Pretty-prints per-request span timeline in console for quick diagnosis.
*/
import { LoadOrderValidator } from './loadOrderValidator';

// Validate: autoLabel must be loaded first
LoadOrderValidator.validate('OPENTELEMETRY', ['AUTO_LABEL'], 'opentelemetry.ts');
// Register this module as loaded
LoadOrderValidator.markLoaded('OPENTELEMETRY', 'opentelemetry.ts');

// Lazy-load OpenTelemetry SDK modules to avoid compile errors when dependencies are missing
let NodeSDK: any;
let Resource: any;
let SemanticResourceAttributes: any;
let getNodeAutoInstrumentations: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NodeSDK = require('@opentelemetry/sdk-node').NodeSDK;
  Resource = require('@opentelemetry/resources').Resource;
  SemanticResourceAttributes = require('@opentelemetry/semantic-conventions').SemanticResourceAttributes;
  getNodeAutoInstrumentations = require('@opentelemetry/auto-instrumentations-node').getNodeAutoInstrumentations;
} catch {}
import {
  ReadableSpan,
  SpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ExportResultCode } from '@opentelemetry/core';
import colors from 'colors/safe';
colors.enable(); // Enable colors
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { logger } from '../../shared/logger';

// Export a small store to share computed totals with request logger for single timing source
export const timelineTotalsStore = new Map<string, number>();
export const getTimelineTotal = (traceId: string): number | undefined => timelineTotalsStore.get(traceId);

// Enable lightweight diagnostics in development
try {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
} catch {}

// Custom exporter that prints a compact request timeline
class TimelineConsoleExporter implements SpanExporter {
  private traces: Map<string, ReadableSpan[]> = new Map();

  export(spans: ReadableSpan[], resultCallback: (result: { code: ExportResultCode }) => void): void {
    try {
      for (const span of spans) {
        const tid = span.spanContext().traceId;
        const arr = this.traces.get(tid) || [];
        arr.push(span);
        this.traces.set(tid, arr);

        // Heuristic: when http.server span ends, print the timeline
        const isHttpServer = (span as any).kind === 1 /* SERVER */ &&
          (span.name.startsWith('HTTP') || this.hasHttpAttributes(span));
        if (isHttpServer) {
          this.printTimeline(tid);
          // cleanup
          this.traces.delete(tid);
        }
      }
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (err) {
      resultCallback({ code: ExportResultCode.FAILED });
    }
  }

  shutdown(): Promise<void> {
    this.traces.clear();
    return Promise.resolve();
  }

  private hasHttpAttributes(span: ReadableSpan): boolean {
    const attrs = span.attributes || {};
    return Boolean(attrs['http.method'] || attrs['http.route'] || attrs['http.target']);
  }

  private fmtMs(ms: number): string {
    return `${ms}ms`;
  }

  private printTimeline(traceId: string) {
    const spans = this.traces.get(traceId) || [];
    if (!spans.length) return;
    const byId = new Map<string, ReadableSpan>();
    const children = new Map<string, ReadableSpan[]>();
    for (const s of spans) {
      byId.set(s.spanContext().spanId, s);
      const pid = s.parentSpanId || '__root__';
      const arr = children.get(pid) || [];
      arr.push(s);
      children.set(pid, arr);
    }
    // Root http.server span as total source
    const httpRoots = spans.filter(s => (s as any).kind === 1 && (s.name.startsWith('HTTP') || (s as any).attributes && ('http.method' in (s as any).attributes)));
    const root = httpRoots.sort((a, b) => (a.startTime[0] - b.startTime[0]) || (a.startTime[1] - b.startTime[1]))[0] || spans[0];
    const startNs = root.startTime[0] * 1e9 + root.startTime[1];
    const endNs = root.endTime[0] * 1e9 + root.endTime[1];
    const totalMs = Math.max(0, Math.round((endNs - startNs) / 1e6));
    // Share total for single timing source usage in requestLogger
    try { timelineTotalsStore.set(traceId, totalMs); } catch {}

    const lines: string[] = [];
    lines.push(((colors.cyan as any).bold)(`⏱️  REQUEST TIMELINE (Total: ${totalMs}ms)`));

    // Severity indicator
    const sev = (ms: number) => (ms >= 300 ? '🐌' : ms >= 50 ? '⚠️' : '✅');
    const durDisp = (ms: number) => {
      if (ms <= 0) return ((colors.green as any).bold)('<1ms');
      return `${ms}ms`;
    };
    const spanKey = (s: ReadableSpan) => `${s.name}|${s.startTime[0]}:${s.startTime[1]}|${s.endTime[0]}:${s.endTime[1]}`;
    const printed = new Set<string>();
    const skippedIds = new Set<string>();
    const genericSeen = new Set<string>();

    // ----- DB dedup (model + operation + rounded startMs) keep the longest duration -----
    // Rationale: multiple instrumentation layers (custom DB + mongoose hooks + OTel)
    // can produce duplicate entries. We dedupe using a stable key and prefer
    // the most complete (longest) span.
    const round = (ns: number) => Math.round(ns / 1e6); // ns -> ms rounded
    const dbLike = spans.filter(s => s.name.startsWith('🗄️') || s.name.startsWith('mongoose.') || s.name.startsWith('mongodb.'));
    const parseDbKey = (s: ReadableSpan): string | undefined => {
      try {
        if (s.name.startsWith('🗄️')) {
          const label = s.name.split('Database:')[1]?.trim();
          if (!label) return undefined;
          const [model, op] = label.split('.');
          const startMs = round((s.startTime[0] * 1e9 + s.startTime[1]) - startNs);
          const bin = Math.floor(startMs / 20) * 20; // 20ms buckets to coalesce dup layers
          return `${model || 'unknown'}|${op || 'op'}|${bin}`;
        }
        if (s.name.startsWith('mongoose.')) {
          const label = s.name.slice('mongoose.'.length);
          const [model, op] = label.split('.');
          const startMs = round((s.startTime[0] * 1e9 + s.startTime[1]) - startNs);
          const bin = Math.floor(startMs / 20) * 20; // 20ms buckets to coalesce dup layers
          return `${model || 'unknown'}|${op || 'op'}|${bin}`;
        }
        // mongodb.* often lacks model name; skip dedup for those
        return undefined;
      } catch {
        return undefined;
      }
    };
    const bestByKey = new Map<string, ReadableSpan>();
    for (const s of dbLike) {
      const key = parseDbKey(s);
      if (!key) continue;
      const curr = bestByKey.get(key);
      const dur = (s.endTime[0] * 1e9 + s.endTime[1]) - (s.startTime[0] * 1e9 + s.startTime[1]);
      if (!curr) {
        bestByKey.set(key, s);
      } else {
        const currDur = (curr.endTime[0] * 1e9 + curr.endTime[1]) - (curr.startTime[0] * 1e9 + curr.startTime[1]);
        const almostEqual = Math.abs(dur - currDur) <= 2e6; // <=2ms
        const preferDbLabel = s.name.startsWith('🗄️') && !curr.name.startsWith('🗄️');
        if (dur > currDur || (almostEqual && preferDbLabel)) bestByKey.set(key, s);
      }
    }
    // Mark duplicates to skip (prefer most complete/longest)
    for (const s of dbLike) {
      const key = parseDbKey(s);
      if (!key) continue;
      const best = bestByKey.get(key);
      if (best && best.spanContext().spanId !== s.spanContext().spanId) {
        skippedIds.add(s.spanContext().spanId);
      }
    }

    const sortChildren = (arr: ReadableSpan[]) => arr.slice().sort((a, b) => (a.startTime[0] - b.startTime[0]) || (a.startTime[1] - b.startTime[1]));
    const classifyLayer = (raw: string): string => {
      const r = raw.toLowerCase();
      if (r.startsWith('controller:')) return 'Controller';
      if (r.startsWith('service:')) return 'Service';
      if (r.startsWith('http') || r.includes('response send') || r.startsWith('stripe.')) return 'Network';
      if (r.includes('validate')) return 'Middleware > Validation';
      if (r.includes('middleware') || r.includes('router') || r.includes('servestatic')) return 'Middleware';
      if (r.includes('cache')) return 'Middleware > Cache';
      if (r.startsWith('🗄️') || r.startsWith('mongoose.') || r.startsWith('mongodb.')) return 'Database';
      if (r.startsWith('jwt') || r.includes('auth')) return 'Security';
      return 'Execution';
    };
    const extractSourceFromStack = (stack?: string): string | undefined => {
      if (!stack) return undefined;
      const text = String(stack);
      const lines = text.split('\n');
      const regex = /([A-Za-z0-9_\-\/\\\.]+\.(ts|tsx|js|jsx):\d+(?::\d+)?)/;
      for (const ln of lines) {
        const m = ln.match(regex);
        if (m && m[1]) {
          let filePath = m[1];
          // Extract from 'src/' onwards if present
          const srcMatch = filePath.match(/(src[\/\\].+)/);
          if (srcMatch) {
            filePath = srcMatch[1].replace(/\\/g, '/');
          }
          return filePath;
        }
      }
      const m2 = text.match(regex);
      if (m2 && m2[1]) {
        let filePath = m2[1];
        // Extract from 'src/' onwards if present
        const srcMatch = filePath.match(/(src[\/\\].+)/);
        if (srcMatch) {
          filePath = srcMatch[1].replace(/\\/g, '/');
        }
        return filePath;
      }
      return undefined;
    };

    // 🆕 NEW: Helper to format captured args/return values
    const formatCapturedData = (
      jsonStr: string,
      count?: number | string,
      type?: 'args' | 'result',
      resultType?: string
    ): string | undefined => {
      try {
        const parsed = JSON.parse(jsonStr);

        // Handle truncated markers
        if (parsed && typeof parsed === 'object' && parsed._truncated) {
          if (parsed._truncated === 'Array') {
            return `[Array: ${parsed.length || 0} items (truncated)]`;
          }
          if (parsed._truncated === 'Object') {
            return `{Object: ${parsed.keys || 0} keys (truncated)}`;
          }
        }

        // Handle special array display formats from formatArray()
        if (parsed && typeof parsed === 'object' && parsed._type === 'Array') {
          if (parsed.empty) {
            return '[]';
          }
          if (parsed._display === 'truncated') {
            return `[Array: ${parsed.length} items, showing first ${parsed.items?.length || 0}]`;
          }
          if (parsed._display === 'summary') {
            return `[Array: ${parsed.length} items (sample shown)]`;
          }
          if (parsed._display === 'huge') {
            return `[Array: ${parsed.length} items - Large dataset ⚠️]`;
          }
        }

        // For arguments array
        if (type === 'args' && Array.isArray(parsed)) {
          const argCount = typeof count === 'number' ? count : parsed.length;
          if (argCount === 0) return '(no arguments)';
          if (argCount === 1) {
            const firstArg = parsed[0];
            if (firstArg === null) return '(null)';
            if (firstArg === undefined) return '(undefined)';
            if (typeof firstArg === 'string') return `"${firstArg.substring(0, 50)}${firstArg.length > 50 ? '...' : ''}"`;
            if (typeof firstArg === 'number' || typeof firstArg === 'boolean') return String(firstArg);
            if (typeof firstArg === 'object') {
              const preview = JSON.stringify(firstArg).substring(0, 100);
              return preview.length < 100 ? preview : preview + '...';
            }
          }
          // Multiple arguments
          return `${argCount} arguments [${parsed.map(a => typeof a).join(', ')}]`;
        }

        // For return values
        if (type === 'result') {
          const rType = resultType || typeof parsed;
          const rLength = typeof count === 'number' ? count : undefined;

          if (parsed === null) return 'null';
          if (parsed === undefined) return 'undefined';
          if (typeof parsed === 'string') {
            return `"${parsed.substring(0, 50)}${parsed.length > 50 ? '...' : ''}"`;
          }
          if (typeof parsed === 'number' || typeof parsed === 'boolean') {
            return String(parsed);
          }
          if (Array.isArray(parsed)) {
            const arrLength = rLength !== undefined ? rLength : parsed.length;
            return `[Array: ${arrLength} items]`;
          }
          if (typeof parsed === 'object') {
            const keys = Object.keys(parsed);
            if (keys.length === 0) return '{}';
            if (keys.length <= 3) {
              return `{${keys.join(', ')}}`;
            }
            return `{Object: ${keys.length} keys}`;
          }
          return String(rType);
        }

        // Fallback: compact JSON
        const compact = JSON.stringify(parsed);
        if (compact.length <= 100) return compact;
        return compact.substring(0, 100) + '...';
      } catch {
        // If JSON parsing fails, show raw string (truncated)
        const str = String(jsonStr);
        if (str.length <= 100) return str;
        return str.substring(0, 100) + '...';
      }
    };

    // Style timeline labels with background colors
    const styleLabel = (tag: string): string => {
      const tagUpper = tag.toUpperCase();

      // Cyan background (route handler + operation begins)
      if (tagUpper === 'EXECUTE' || tagUpper === 'START') {
        return ((colors.bgCyan as any).black.bold)(` ${tag} `);
      }

      // Green background (operation ends)
      if (tagUpper === 'COMPLETE' || tagUpper === 'DONE') {
        return ((colors.bgGreen as any).black.bold)(` ${tag} `);
      }

      // Blue background (service calls + network)
      if (tagUpper === 'CALL' || tagUpper === 'RETURN' || tagUpper === 'SEND') {
        return ((colors.bgBlue as any).white.bold)(` ${tag} `);
      }

      // Red background (failures)
      if (tagUpper === 'ERROR' || tagUpper === 'FAILED') {
        return ((colors.bgRed as any).white.bold)(` ${tag} `);
      }

      // Default: no background, just brackets
      return `[${tag}]`;
    };

    // Format received data for validation display
    const formatReceivedData = (data: any): string => {
      try {
        if (typeof data === 'string') {
          // If it's already a string, just truncate if too long
          return data.length > 200 ? data.substring(0, 200) + '...' : data;
        }
        // Otherwise stringify it
        const str = JSON.stringify(data);
        return str.length > 200 ? str.substring(0, 200) + '...' : str;
      } catch {
        return String(data);
      }
    };

    const printNode = (s: ReadableSpan, indent: string, isLastChild = false) => {
      // Skip spans marked as duplicates
      if (skippedIds.has(s.spanContext().spanId)) return; // dedup skip
      // Dedup driver vs custom DB spans: skip mongoose/mongodb only when a matching custom 🗄️ span exists for the same model/op bucket
      if (s.name.startsWith('mongodb.') || s.name.startsWith('mongoose.')) {
        const key = parseDbKey(s);
        if (key) {
          const best = bestByKey.get(key);
          if (best && best.name.startsWith('🗄️') && best.spanContext().spanId !== s.spanContext().spanId) {
            return;
          }
        }
      }
      const key = spanKey(s);
      if (printed.has(key)) return;
      printed.add(key);
      const startMs = Math.max(0, Math.round(((s.startTime[0] * 1e9 + s.startTime[1]) - startNs) / 1e6));
      const endMs = Math.max(0, Math.round(((s.endTime[0] * 1e9 + s.endTime[1]) - startNs) / 1e6));
      // Lightweight generic dedup: same label within ~10ms bucket (e.g., JWT.sign)
      const gkey = `${s.name}|${Math.floor(startMs / 100)}`; // 100ms window
      if (genericSeen.has(gkey) && !s.name.startsWith('🗄️')) return;
      genericSeen.add(gkey);
      const durMs = Math.max(0, Math.round(((s.endTime[0] * 1e9 + s.endTime[1]) - (s.startTime[0] * 1e9 + s.startTime[1])) / 1e6));
      const statusErr = s.status?.code === 2;
      const attrs: any = (s as any).attributes || {};

      // All spans use cyan color
      const spanColor = ((colors.cyan as any).bold);

      const label = s.name
        .replace(/^Service: /, '⚙️  Service: ')
        .replace(/^Controller: /, '🎮 Controller: ')
        .replace(/^Cache: /, '💾 Cache: ')
        .replace(/^Response Serialization$/, '🧩 Response Serialization')
        .replace(/^🌐 HTTP Response Send$/, '🌐 Network: HTTP Response Send')
        .replace(/^Stripe\./, '💳 Stripe: ');
      // Event lifecycle mapping
      const raw = s.name;
      let startTag: string | undefined;
      let endTag: string | undefined;
      let singleTag: string | undefined;
      if (raw.startsWith('Controller: ')) {
        startTag = 'START';
        endTag = 'COMPLETE';
      } else if (raw.startsWith('Service: ')) {
        startTag = 'CALL';
        endTag = 'RETURN';
      } else if (raw.startsWith('Stripe.')) {
        // Stripe SDK operations (including webhooks.constructEvent)
        startTag = 'CALL';
        endTag = 'RESULT';
      } else if (raw.startsWith('🗄️') || raw.startsWith('mongoose.') || raw.startsWith('mongodb.')) {
        startTag = 'QUERY_START';
        endTag = 'QUERY_COMPLETE';
      } else if (raw === '🌐 HTTP Response Send') {
        singleTag = 'SEND';
      } else if (raw.toLowerCase().includes('validate')) {
        // Explicit Validation lifecycle tags
        startTag = 'VALIDATE_START';
        endTag = 'VALIDATE_COMPLETE';
      } else if (raw.startsWith('HTTP') && raw !== '🌐 HTTP Response Send') {
        startTag = 'REQUEST';
        endTag = 'RESPONSE';
      } else if (raw.toLowerCase().includes('cache')) {
        singleTag = 'CACHE';
      } else if (durMs > 50) {
        startTag = 'EXECUTE_START';
        endTag = 'EXECUTE_COMPLETE';
      } else {
        singleTag = 'EXECUTE';
      }

      // Capture events early for special-casing Validation/Error Handler rendering
      const evts: any[] = ((s as any).events || []) as any[];
      const exc = evts.find(e => String(e.name).toLowerCase().includes('exception'));
      const isValidation = raw.toLowerCase().includes('validate') || !!attrs['validation.data'] || attrs['validation.type'] === 'zod';
      const isErrorHandler = raw === 'Error Handler';
      const isController = raw.startsWith('Controller: ');
      const isService = raw.startsWith('Service: ');
      const isControllerOrService = isController || isService;

      // Check if this is a route handler span
      const isRouteHandler = (raw.toLowerCase().includes('request handler') || raw.toLowerCase().includes('http'))
        && (attrs['http.route'] || attrs['http.target'] || raw.includes('/api/'));

      if (singleTag) {
        // Special formatting for route handler
        if (isRouteHandler) {
          const routePath = attrs['http.route'] || attrs['http.target'] || raw.split(/\s+-\s+/)[1] || raw.split(/\s+/).slice(1).join(' ');
          const percentage = totalMs > 0 ? ((durMs / totalMs) * 100).toFixed(1) : '0.0';
          const routeLabel = ((colors.bgMagenta as any).white.bold)(`Route Handler: ${routePath}`);
          lines.push(colors.cyan(`${indent}├─ `) + ((colors.magenta as any).bold)(`[${startMs}-${endMs}ms] `) + routeLabel + ((colors.magenta as any).bold)(` ${styleLabel(singleTag)} (${durDisp(durMs)} | ${percentage}%) ${statusErr ? '⚠️' : sev(durMs)}`));
          // Add cyan vertical bar after route handler for visual separation
          lines.push(colors.cyan('│'));
        } else if (isValidation) {
          // Special formatting for validation spans with singleTag (EXECUTE)
          const percentage = totalMs > 0 ? ((durMs / totalMs) * 100).toFixed(1) : '0.0';
          const schemaName = attrs['validation.schema'] || 'Schema';
          const statusIcon = (statusErr || !!exc) ? '🔴' : sev(durMs);
          const validationLabel = ((colors.bgGreen as any).black.bold)(`Validation`);
          const branch = isLastChild ? `└─ ` : `├─ `;
          lines.push(colors.cyan(`${indent}${branch}`) + spanColor(`[${startMs}-${endMs}ms] `) + validationLabel + spanColor(` (${durDisp(durMs)} | ${percentage}%) ${statusIcon}`));

          // START event
          const innerBranch = isLastChild ? `   ├─ ` : `│  ├─ `;
          lines.push(colors.cyan(`${indent}${innerBranch}`) + spanColor(`[${startMs}ms] START   Zod schema: ${schemaName}`));

          // Received data
          if (attrs['validation.data']) {
            try {
              const receivedData = attrs['validation.data'];
              const formatted = formatReceivedData(receivedData);
              const receivedBranch = isLastChild ? `   ├─ ` : `│  ├─ `;
              lines.push(colors.cyan(`${indent}${receivedBranch}`) + colors.blue(`Received: ${formatted}`));
            } catch {}
          }

          // SUCCESS/ERROR event will be handled in the error block below if there's an error
          // Otherwise, show SUCCESS here
          if (!exc && !statusErr) {
            const count = attrs['validation.fields.count'] || 0;
            const endLabel = `${count} field${count > 1 ? 's' : ''} validated`;
            const completeBranch = isLastChild ? `   └─ ` : `│  └─ `;
            lines.push(colors.cyan(`${indent}${completeBranch}`) + spanColor(`[${endMs}ms] COMPLETE   ${endLabel} ${sev(durMs)}`));
          }
        } else {
          // Check if this is Network/HTTP Response Send or Response Serialization
          const isNetworkSend = raw === '🌐 HTTP Response Send';
          const isResponseSerialization = raw === 'Response Serialization';

          // Check if this is JWT operation (singleTag but needs special format)
          const isJWTSingle = raw.startsWith('JWT.');

          if (isJWTSingle) {
            // JWT: Special format with time range, percentage, and START/DONE (even for singleTag)
            const percentage = totalMs > 0 ? ((durMs / totalMs) * 100).toFixed(1) : '0.0';
            const resultMessage = attrs['jwt.result.message'];

            const bgColor = ((colors.bgCyan as any).white.bold);
            const branch = isLastChild ? `└─ ` : `├─ `;
            lines.push(colors.cyan(`${indent}${branch}`) + spanColor(`[${startMs}-${endMs}ms] `) + bgColor(label || '') + spanColor(` (${durDisp(durMs)} | ${percentage}%) ${sev(durMs)}`));

            const detailIndent = isLastChild ? `      ` : `│      `;
            lines.push(colors.cyan(`${indent}${detailIndent}├─ `) + spanColor(`[${startMs}ms] START`));
            const doneLabel = resultMessage ? `  ${resultMessage}` : '';
            lines.push(colors.cyan(`${indent}${detailIndent}└─ `) + spanColor(`[${endMs}ms] DONE${doneLabel}`));
          } else if (isNetworkSend || isResponseSerialization) {
            // Special format with return flow - always use continuation bars
            lines.push(colors.cyan(`${indent}└─ `) + spanColor(`[${startMs}ms] ${label} ${styleLabel(singleTag)} - ${durDisp(durMs)} ${statusErr ? '⚠️' : sev(durMs)}`));
            const returnsTo = isNetworkSend ? 'Client' : 'Controller';
            lines.push(colors.cyan(`${indent}│      └─ `) + `🔙 Returns to: ${returnsTo}`);
            // Always add blank continuation line after network/serialization
            lines.push(colors.cyan(`${indent}│`));
          } else {
            // Default format for other single-tag spans
            const branch = isLastChild ? `└─ ` : `├─ `;
            lines.push(colors.cyan(`${indent}${branch}`) + spanColor(`[${startMs}ms] ${label} ${styleLabel(singleTag)} - ${durDisp(durMs)} ${statusErr ? '⚠️' : sev(durMs)}`));
          }
        }
      } else {
        if (isControllerOrService) {
          // NEW FORMAT: Controller/Service with time range, percentage, and return flow
          const percentage = totalMs > 0 ? ((durMs / totalMs) * 100).toFixed(1) : '0.0';
          const statusIcon = (statusErr || !!exc) ? '🔴' : sev(durMs);

          // Remove emoji from label for header
          const cleanLabel = label
            .replace('🎮 Controller: ', 'Controller: ')
            .replace('⚙️  Service: ', 'Service: ');

          // Header line with time range and percentage with background color
          const labelWithBg = isController
            ? ((colors.bgMagenta as any).white.bold)(cleanLabel)
            : ((colors.bgBlue as any).white.bold)(cleanLabel);

          // Use └─ if this is the last child, otherwise ├─
          const branch = isLastChild ? `└─ ` : `├─ `;
          lines.push(colors.cyan(`${indent}${branch}`) + spanColor(`[${startMs}-${endMs}ms] `) + labelWithBg + spanColor(` (${durDisp(durMs)} | ${percentage}%) ${statusIcon}`));

          // Continuation line (use spaces for last child)
          const continuation = isLastChild ? `       │` : `│      │`;
          lines.push(colors.cyan(`${indent}${continuation}`));

          // Simplified START/CALL line
          const innerBranch = isLastChild ? `       ├─ ` : `│      ├─ `;
          lines.push(colors.cyan(`${indent}${innerBranch}`) + spanColor(`[${startMs}ms]  ${startTag}`));

          // Continuation line after START/CALL
          lines.push(colors.cyan(`${indent}${continuation}`));

          // Display captured arguments (if any)
          if (attrs['function.args']) {
            try {
              const argsStr = String(attrs['function.args']);
              const argsCount = attrs['function.args.count'];
              const formatted = formatCapturedData(argsStr, argsCount, 'args');
              if (formatted) {
                const argsBranch = isLastChild ? `       ├─ ` : `│      ├─ `;
                lines.push(colors.cyan(`${indent}${argsBranch}`) + colors.blue(`Args: ${formatted}`));
              }
            } catch {}
          }

          // Continuation line before children (if Args were shown)
          if (attrs['function.args']) {
            lines.push(colors.cyan(`${indent}${continuation}`));
          }

          // *** RENDER CHILDREN HERE (between START and COMPLETE) ***
          const kids = sortChildren(children.get(s.spanContext().spanId || '') || []);
          const nextIndent = isLastChild ? indent + `       ` : indent + `│      `;

          // Pass isLastChild flag to each child
          for (let i = 0; i < kids.length; i++) {
            const isLastKid = (i === kids.length - 1);
            printNode(kids[i], nextIndent, isLastKid);
          }

          // Simplified COMPLETE/RETURN line (no blank line before it)
          const actualDur = endMs - startMs;
          const displayDur = actualDur > 0 ? actualDur : durMs;
          const completeBranch = isLastChild ? `       └─ ` : `│      └─ `;
          lines.push(colors.cyan(`${indent}${completeBranch}`) + spanColor(`[${endMs}ms]  ${endTag}  (${durDisp(displayDur)}) ${statusIcon}`));

          // Return flow indicator
          const resultPrefix = isLastChild ? `              ├─ ` : `│              ├─ `;
          lines.push(colors.cyan(`${indent}${resultPrefix}`) + `📤 Result: ${attrs['function.result'] ? formatCapturedData(String(attrs['function.result']), attrs['function.result.length'], 'result', attrs['function.result.type']) : '{...}'}`);

          const returnsTo = isService ? 'Controller' : 'Route Handler';
          const returnPrefix = isLastChild ? `              └─ ` : `│              └─ `;
          lines.push(colors.cyan(`${indent}${returnPrefix}`) + `🔙 Returns to: ${returnsTo}`);

          // Add blank continuation line after COMPLETE
          if (isController) {
            // Controller is at root level, just single bar
            lines.push(colors.cyan(`│`));
          } else if (isService) {
            // Service is nested, use indent with continuation
            const serviceContinuation = isLastChild ? `       │` : `│      `;
            lines.push(colors.cyan(`${indent}${serviceContinuation}`));
          }

        } else if (isValidation) {
          // ENHANCED FORMAT: Validation with startTag/endTag (VALIDATE_START/VALIDATE_COMPLETE)
          const percentage = totalMs > 0 ? ((durMs / totalMs) * 100).toFixed(1) : '0.0';
          const schemaName = attrs['validation.schema'] || 'Schema';
          const statusIcon = (statusErr || !!exc) ? '🔴' : sev(durMs);

          // Header line with time range and percentage
          const validationLabel = ((colors.bgGreen as any).black.bold)(`Validation`);
          const branch = isLastChild ? `└─ ` : `├─ `;
          lines.push(colors.cyan(`${indent}${branch}`) + spanColor(`[${startMs}-${endMs}ms] `) + validationLabel + spanColor(` (${durDisp(durMs)} | ${percentage}%) ${statusIcon}`));

          // START event with schema name
          const innerBranch = isLastChild ? `   ├─ ` : `│  ├─ `;
          lines.push(colors.cyan(`${indent}${innerBranch}`) + spanColor(`[${startMs}ms] START   Zod schema: ${schemaName}`));

          // Received data
          if (attrs['validation.data']) {
            try {
              const receivedData = attrs['validation.data'];
              const formatted = formatReceivedData(receivedData);
              const receivedBranch = isLastChild ? `   ├─ ` : `│  ├─ `;
              lines.push(colors.cyan(`${indent}${receivedBranch}`) + colors.blue(`Received: ${formatted}`));
            } catch {}
          }

          // SUCCESS/ERROR event will be handled in the error block below if there's an error
          // Otherwise, show SUCCESS here
          if (!exc && !statusErr) {
            const count = attrs['validation.fields.count'] || 0;
            const endLabel = `${count} field${count > 1 ? 's' : ''} validated`;
            const actualDur = endMs - startMs;
            const displayDur = actualDur > 0 ? actualDur : durMs;
            const completeBranch = isLastChild ? `   └─ ` : `│  └─ `;
            lines.push(colors.cyan(`${indent}${completeBranch}`) + spanColor(`[${endMs}ms] COMPLETE   ${endLabel} ${sev(displayDur)}`));
          }
        } else {
          // Special handling for Database queries, bcrypt, and JWT
          const isDatabase = s.name.startsWith('🗄️');
          const isBcrypt = raw.toLowerCase().includes('bcrypt');
          const isJWT = raw.startsWith('JWT.');

          if (isDatabase) {
            // DATABASE QUERY: Special format with time range, percentage, and nested details
            const percentage = totalMs > 0 ? ((durMs / totalMs) * 100).toFixed(1) : '0.0';
            const dbLabel = label.replace('🗄️  Database:', 'MongoDB:');
            const indexUsed = attrs['db.index_used'];
            const docsExamined = attrs['db.docs_examined'];
            const nReturned = attrs['db.n_returned'];
            const efficiency = attrs['db.scan_efficiency'];
            const executionStage = attrs['db.execution_stage'];
            const completionMessage = attrs['db.completion_message'];

            // Header with time range
            const branch = isLastChild ? `└─ ` : `├─ `;
            lines.push(colors.cyan(`${indent}${branch}`) + spanColor(`[${startMs}-${endMs}ms] `) + ((colors.bgCyan as any).white.bold)(dbLabel || '') + spanColor(` (${durDisp(durMs)} | ${percentage}%) ${sev(durMs)}`));

            // Details nested under header
            const detailIndent = isLastChild ? `      ` : `│      `;

            // QUERY_START
            lines.push(colors.cyan(`${indent}${detailIndent}├─ `) + spanColor(`[${startMs}ms] QUERY_START`));

            // Index display
            if (executionStage || indexUsed) {
              const isCollscan = String(executionStage || '').toUpperCase().includes('COLLSCAN') || indexUsed === 'NO_INDEX';
              const indexDisplay = isCollscan
                ? ((colors.bgRed as any).white.bold)('COLLSCAN') + ' ⚠️'
                : indexUsed || 'n/a';
              lines.push(colors.cyan(`${indent}${detailIndent}├─ `) + `[${endMs}ms] Index Used: ${indexDisplay}`);
            }

            // Scanned and Returned
            if (typeof docsExamined === 'number' || typeof nReturned === 'number') {
              lines.push(colors.cyan(`${indent}${detailIndent}├─ `) + `[${endMs}ms] Scanned: ${typeof docsExamined === 'number' ? docsExamined : 'n/a'}  | Returned: ${typeof nReturned === 'number' ? nReturned : 'n/a'}`);
            }

            // Efficiency
            if (efficiency) {
              lines.push(colors.cyan(`${indent}${detailIndent}├─ `) + `[${endMs}ms] Efficiency: ${efficiency}`);
            }

            // Execution Stage
            if (executionStage) {
              const stageColor: any = String(executionStage).includes('COLLSCAN') ? ((colors.red as any).bold) : ((colors.green as any).bold);
              lines.push(colors.cyan(`${indent}${detailIndent}├─ `) + `[${endMs}ms] Stage: ${stageColor(executionStage)}`);
            }

            // QUERY_COMPLETE with completion message
            const completionLabel = completionMessage ? `  ${completionMessage}` : '';
            lines.push(colors.cyan(`${indent}${detailIndent}└─ `) + spanColor(`[${endMs}ms] ${styleLabel('QUERY_COMPLETE')}${completionLabel}`));

            // Add blank continuation line for visual separation (if not last child)
            if (!isLastChild) {
              lines.push(colors.cyan(`${indent}│`));
            }

          } else if (isBcrypt || isJWT) {
            // BCRYPT/JWT: Special format with time range, percentage, and START/DONE
            const percentage = totalMs > 0 ? ((durMs / totalMs) * 100).toFixed(1) : '0.0';
            const resultMessage = attrs['bcrypt.result.message'] || attrs['jwt.result.message'];

            // Header
            const bgColor = isBcrypt
              ? ((colors.bgYellow as any).black.bold)
              : ((colors.bgCyan as any).white.bold);

            const branch = isLastChild ? `└─ ` : `├─ `;
            lines.push(colors.cyan(`${indent}${branch}`) + spanColor(`[${startMs}-${endMs}ms] `) + bgColor(label || '') + spanColor(` (${durDisp(durMs)} | ${percentage}%) ${sev(durMs)}`));

            // Details with proper indentation
            const detailIndent = isLastChild ? `      ` : `│      `;

            // START
            lines.push(colors.cyan(`${indent}${detailIndent}├─ `) + spanColor(`[${startMs}ms] START`));

            // DONE with result message
            const doneLabel = resultMessage ? `  ${resultMessage}` : '';
            lines.push(colors.cyan(`${indent}${detailIndent}└─ `) + spanColor(`[${endMs}ms] DONE${doneLabel}`));

            // Add blank continuation line for visual separation (if not last child)
            if (!isLastChild) {
              lines.push(colors.cyan(`${indent}│`));
            }

          } else {
            // EXISTING FORMAT: All other span types
            // Start line
            const branch = isLastChild ? `└─ ` : `├─ `;
            lines.push(colors.cyan(`${indent}${branch}`) + spanColor(`[${startMs}ms] ${label} ${styleLabel(startTag || 'START')}`));

            // Display captured arguments (after START/CALL)
            if (attrs['function.args']) {
              try {
                const argsStr = String(attrs['function.args']);
                const argsCount = attrs['function.args.count'];
                const formatted = formatCapturedData(argsStr, argsCount, 'args');
                if (formatted) {
                  const argsBranch = isLastChild ? `   ├─ ` : `│  ├─ `;
                  lines.push(colors.cyan(`${indent}${argsBranch}`) + colors.blue(`Args: ${formatted}`));
                }
              } catch {}
            }

            // End line
            const actualDur = endMs - startMs;
            const displayDur = actualDur > 0 ? actualDur : durMs;

            const endBranch = isLastChild ? `   └─ ` : `│  └─ `;
            lines.push(colors.cyan(`${indent}${endBranch}`) + spanColor(`[${endMs}ms] ${styleLabel(endTag || 'COMPLETE')} ${label} (${durDisp(displayDur)}) ${statusErr ? '⚠️' : sev(displayDur)}`));

            // Display captured return value (after RETURN/COMPLETE)
            if (attrs['function.result']) {
              try {
                const resultStr = String(attrs['function.result']);
                const resultType = attrs['function.result.type'];
                const resultLength = attrs['function.result.length'];
                const formatted = formatCapturedData(resultStr, resultLength, 'result', resultType);
                if (formatted) {
                  const resultPrefix = isLastChild ? `        ` : `│       `;
                  lines.push(colors.cyan(`${indent}${resultPrefix}`) + ((colors.green as any).bold)(`📤 Result: ${formatted}`));
                }
              } catch {}
            }
          }
        }
      }

      // Inline error details under the span if any exception recorded
      try {
        if (exc) {
          let etype = exc.attributes?.['exception.type'] || 'Error';
          // Normalize common validator error names for clearer display
          if (etype === 'ZodError') etype = 'ValidationError';
          const emsg = exc.attributes?.['exception.message'] || s.status?.message || 'An error occurred';
          const estack = exc.attributes?.['exception.stacktrace'];
          let src = extractSourceFromStack(estack);
          if (!src) {
            const vsrc = attrs['validation.source'];
            src = extractSourceFromStack(typeof vsrc === 'string' ? vsrc : undefined);
          }
          const eNs = (exc.time?.[0] || s.endTime[0]) * 1e9 + (exc.time?.[1] || s.endTime[1]);
          const eMs = Math.max(0, Math.round((eNs - startNs) / 1e6));
          const layer = attrs['layer'] || classifyLayer(raw);
          // Do not render inline error block for Error Handler (it formats error but isn't an error itself)
          if (!isErrorHandler) {
            // Calculate duration from START to ERROR
            const errorDur = eMs - startMs;
            const displayDur = errorDur > 0 ? errorDur : durMs;

            // For validation errors, use special tree structure
            if (isValidation && etype === 'ValidationError') {
              lines.push(colors.cyan(`${indent}│  └─ `) + ((colors.red as any).bold)(`[${eMs}ms]  ERROR  Validation failed (${displayDur}ms) 🔴`));

              // Failed fields with nested tree structure
              try {
                const parsed = typeof emsg === 'string' && emsg.trim().startsWith('[') ? JSON.parse(emsg) : null;
                if (parsed && Array.isArray(parsed) && parsed.length > 0) {
                  lines.push(colors.cyan(`${indent}│       ├─ `) + colors.red(`❌ Failed fields:`));
                  for (const issue of parsed) {
                    const field = issue.path?.[issue.path.length - 1] || 'unknown';
                    const message = issue.message || 'Invalid value';
                    const expected = issue.expected || 'valid value';
                    const received = issue.received || issue.received_type || 'invalid';
                    lines.push(colors.cyan(`${indent}│       │      `) + colors.red(`• ${field}: ${message} (expected: ${expected}, got: ${received})`));
                  }
                } else {
                  lines.push(colors.cyan(`${indent}│       ├─ `) + colors.red(`🚨 ${etype}: ${emsg}`));
                }
              } catch {
                lines.push(colors.red(`${indent}│       ├─ 🚨 ${etype}: ${emsg}`));
              }

              // Layer, Source, Schema file
              const hasSchemaFile = !!attrs['validation.schema.file'];
              const hasSource = !!src;

              if (hasSource && hasSchemaFile) {
                // All three exist: Layer ├─, Source ├─, Schema └─
                lines.push(colors.cyan(`${indent}│       ├─ `) + colors.blue(`📍 Layer: ${layer}`));
                lines.push(colors.cyan(`${indent}│       ├─ `) + colors.blue(`📂 Source: ${src}`));
                lines.push(colors.blue(`${indent}│       └─ 📋 Schema: ${attrs['validation.schema.file']}`));
              } else if (hasSource && !hasSchemaFile) {
                // Layer and Source: Layer ├─, Source └─
                lines.push(colors.cyan(`${indent}│       ├─ `) + colors.blue(`📍 Layer: ${layer}`));
                lines.push(colors.blue(`${indent}│       └─ 📂 Source: ${src}`));
              } else if (!hasSource && hasSchemaFile) {
                // Layer and Schema: Layer ├─, Schema └─
                lines.push(colors.cyan(`${indent}│       ├─ `) + colors.blue(`📍 Layer: ${layer}`));
                lines.push(colors.blue(`${indent}│       └─ 📋 Schema: ${attrs['validation.schema.file']}`));
              } else {
                // Only Layer: use └─
                lines.push(colors.blue(`${indent}│       └─ 📍 Layer: ${layer}`));
              }

              // Blank line after validation error
              lines.push(colors.cyan('│'));
            } else {
              // Non-validation errors use standard format
              lines.push(colors.cyan(`${indent}└─ `) + ((colors.red as any).bold)(`[${eMs}ms] ${styleLabel('ERROR')} ${emsg || 'An error occurred'} (${displayDur}ms) 🔴`));
              lines.push(colors.red(`${indent}   🚨 ${etype}: ${emsg}`));
              lines.push(colors.blue(`${indent}   📍 Layer: ${layer}`));
              if (src) lines.push(colors.blue(`${indent}   📂 Source: ${src}`));
            }
          }
        }
      } catch {}

      // Database metrics are now displayed inline within the database query section above
      // This section has been removed to avoid duplication

      // Render children for all spans EXCEPT Controller/Service (they handle their own children)
      if (!isControllerOrService) {
        const kids = sortChildren(children.get(s.spanContext().spanId || '') || []);
        const nextIndent = isLastChild ? `${indent}     ` : `${indent}│  `;
        for (let i = 0; i < kids.length; i++) {
          const isLastKid = (i === kids.length - 1);
          printNode(kids[i], nextIndent, isLastKid);
        }
      }

      // Extra note under Error Handler span for clarity
      if (isErrorHandler) {
        lines.push(colors.cyan(`${indent}│  📝 Formatted error response`));
      }
    };

    // ----- Group middleware into a single stacked entry -----
    // Rationale: 18+ middleware spans clutter output. We collapse them into
    // one aggregated block and show a brief breakdown of the slowest three.
    const rootChildren = sortChildren(children.get(root.spanContext().spanId) || []);
    const middlewareSpans = rootChildren.filter(s => {
      const n = s.name.toLowerCase();
      return n.includes('middleware') || n.includes('router') || n.includes('servestatic') || n.includes('logger');
    });
    if (middlewareSpans.length) {
      const mwStartNs = Math.min(...middlewareSpans.map(s => s.startTime[0] * 1e9 + s.startTime[1]));
      const mwEndNs = Math.max(...middlewareSpans.map(s => s.endTime[0] * 1e9 + s.endTime[1]));
      const mwDurMs = Math.max(0, Math.round((mwEndNs - mwStartNs) / 1e6));
      const mwStartMs = Math.max(0, Math.round((mwStartNs - startNs) / 1e6));
      const mwEndMs = Math.max(0, Math.round((mwEndNs - startNs) / 1e6));
      const mwPercentage = totalMs > 0 ? ((mwDurMs / totalMs) * 100).toFixed(1) : '0.0';
      lines.push(colors.cyan(`├─ `) + ((colors.magenta as any).bold)(`[${mwStartMs}-${mwEndMs}ms] Middleware Stack (${durDisp(mwDurMs)} | ${mwPercentage}%) ${sev(mwDurMs)}`));
      // Show ALL middlewares in execution order
      const sortedMiddlewares = middlewareSpans
        .map(s => ({
          s,
          dur: Math.max(0, Math.round(((s.endTime[0] * 1e9 + s.endTime[1]) - (s.startTime[0] * 1e9 + s.startTime[1])) / 1e6)),
          startNs: s.startTime[0] * 1e9 + s.startTime[1]
        }))
        .sort((a, b) => a.startNs - b.startNs);  // Sort by start time (execution order)

      // Deduplicate: Keep only first occurrence of each middleware at same time
      const seenMiddlewares = new Map<string, boolean>();
      const dedupedMiddlewares = sortedMiddlewares.filter(item => {
        const cleanName = item.s.name
          .replace(/^Middleware\s*/i, '')
          .replace(/^-\s*/, '')
          .trim() || item.s.name;

        const startMs = Math.max(0, Math.round((item.startNs - startNs) / 1e6));
        const key = `${cleanName}|${startMs}`;  // Unique key: name + start time

        if (seenMiddlewares.has(key)) {
          return false;  // Skip duplicate
        }

        seenMiddlewares.set(key, true);
        return true;  // Keep first occurrence
      });

      for (let i = 0; i < dedupedMiddlewares.length; i++) {
        const { s, dur } = dedupedMiddlewares[i];
        const name = s.name
          .replace(/^Middleware\s*/i, '')  // Remove "Middleware" prefix
          .replace(/^-\s*/, '')             // Remove dash prefix "- "
          .trim() || s.name;
        const isLast = i === dedupedMiddlewares.length - 1;
        const prefix = isLast ? '└─' : '├─';

        // Remove individual middleware timestamps for cleaner display
        lines.push(colors.cyan(`│  ${prefix} ${name} (${durDisp(dur)})`));
      }

      // Add blank line for visual separation after middleware stack with vertical bar
      lines.push(colors.cyan('│'));

      // Skip ALL middleware spans from the timeline (we only show the group)
      // EXCEPT validation spans which are important for debugging
      for (const s of middlewareSpans) {
        const name = String(s.name).toLowerCase();
        if (!name.includes('validate')) {
          skippedIds.add(s.spanContext().spanId);
        }
      }
    }


    // Print controller/service and others under root
    const top = sortChildren(children.get(root.spanContext().spanId) || []).filter(s => !skippedIds.has(s.spanContext().spanId));
    for (let i = 0; i < top.length; i++) {
      const isLast = (i === top.length - 1);
      printNode(top[i], '', isLast);
    }

    // Finally print response send if present and not printed
    const resp = spans.filter(s => s.name === '🌐 HTTP Response Send');
    for (let i = 0; i < resp.length; i++) {
      const isLast = (i === resp.length - 1);
      printNode(resp[i], '', isLast);
    }

    // Completion line (success/failure depending on status or exceptions)
    const httpStatus = (root as any).attributes?.['http.status_code'];
    const hasErrorSpan = spans.some(s => s.status?.code === 2 || (((s as any).events || []).some((e: any) => String(e.name).toLowerCase().includes('exception'))));
    if (hasErrorSpan || (typeof httpStatus === 'number' && httpStatus >= 400)) {
      lines.push(colors.cyan(`└─ `) + ((colors.red as any).bold)(`[${totalMs}ms] ❌ Request Failed with Error (Total: ${totalMs}ms)`));
    } else {
      lines.push(colors.cyan(`└─ `) + ((colors.green as any).bold)(`[${totalMs}ms] ✅ Request Completed Successfully (Total: ${totalMs}ms)`));
    }

    // ERROR SUMMARY block (if any error)
    if (hasErrorSpan || (typeof httpStatus === 'number' && httpStatus >= 400)) {
      try {
        // Choose earliest exception event for summary
        let best: { e: any; s: ReadableSpan } | undefined;
        for (const s of spans) {
          const evts: any[] = ((s as any).events || []) as any[];
          for (const e of evts) {
            if (!String(e.name).toLowerCase().includes('exception')) continue;
            if (!best) best = { e, s };
            else {
              const currNs = best.e.time[0] * 1e9 + best.e.time[1];
              const eNs = e.time[0] * 1e9 + e.time[1];
              if (eNs < currNs) best = { e, s };
            }
          }
        }
        const statusText = typeof httpStatus === 'number' ? `${httpStatus}` : 'Error';
        lines.push(((colors.red as any).bold)('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        lines.push(((colors.bgRed as any).white.bold)('🚨 ERROR SUMMARY'));
        lines.push(((colors.red as any).bold)('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        lines.push(((colors.red as any).bold)(`❌ Status: ${typeof httpStatus === 'number' ? httpStatus >= 400 ? `${httpStatus} Bad Request` : String(httpStatus) : 'Error'}`));
        if (best) {
          let etype = best.e.attributes?.['exception.type'] || 'Error';
          if (etype === 'ZodError') etype = 'ValidationError';
          const emsgRaw = best.e.attributes?.['exception.message'] || best.s.status?.message || 'An error occurred';
          const estack = best.e.attributes?.['exception.stacktrace'];
          let src = extractSourceFromStack(estack);
          if (!src) {
            const vsrc = (best.s as any).attributes?.['validation.source'];
            src = extractSourceFromStack(typeof vsrc === 'string' ? vsrc : undefined);
          }
          const eNs = best.e.time[0] * 1e9 + best.e.time[1];
          const eMs = Math.max(0, Math.round((eNs - startNs) / 1e6));
          const layerAttr = (best.s as any).attributes?.['layer'];
          const layer = layerAttr || classifyLayer(best.s.name);
          lines.push(colors.red(`🏷️  Type: ${etype}`));
          lines.push(colors.blue(`📍 Layer: ${layer}`));
          lines.push(colors.yellow(`⏱️  Failed at: ${eMs}ms (${totalMs > 0 ? Math.round((eMs / totalMs) * 1000) / 10 : 0}% into request)`));
          if (src) lines.push(colors.blue(`📂 Source: ${src}`));

          // Friendly validation summary formatting if message looks like JSON
          let formatted = false;
          if (etype === 'ValidationError') {
            try {
              const parsed = typeof emsgRaw === 'string' && (emsgRaw.trim().startsWith('[') || emsgRaw.trim().startsWith('{'))
                ? JSON.parse(emsgRaw)
                : undefined;
              const items: any[] = Array.isArray(parsed) ? parsed : (Array.isArray((parsed as any)?.issues) ? (parsed as any).issues : undefined);
              if (items && items.length) {
                lines.push(((colors.yellow as any).bold)(`💬 Message: Validation failed`));
                lines.push(((colors.cyan as any).bold)(`📋 Missing fields:`));
                for (const it of items) {
                  const pathArr = it.path || [];
                  const field = Array.isArray(pathArr) && pathArr.length ? String(pathArr[pathArr.length - 1]) : (it.path || 'unknown');
                  const expected = it.expected ?? it.expected_type ?? 'n/a';
                  const received = it.received ?? it.received_type ?? 'n/a';
                  const msg = it.message || 'Invalid value';
                  lines.push(colors.red(`   • ${field}: ${msg} (expected: ${expected}, got: ${received})`));
                }
                formatted = true;
              }
            } catch {}
          }
          if (!formatted) {
            lines.push(((colors.yellow as any).bold)(`💬 Message: ${emsgRaw}`));
          }
        }
      } catch {}
    }

    // 📊 LATENCY BREAKDOWN (moved to very bottom)
    const sumDur = (arr: ReadableSpan[]) => arr.reduce((acc, s) => acc + Math.max(0, Math.round(((s.endTime[0] * 1e9 + s.endTime[1]) - (s.startTime[0] * 1e9 + s.startTime[1])) / 1e6)), 0);
    const dbMs = Array.from(bestByKey.values()).reduce((acc, s) => acc + Math.max(0, Math.round(((s.endTime[0] * 1e9 + s.endTime[1]) - (s.startTime[0] * 1e9 + s.startTime[1])) / 1e6)), 0);
    const serviceMs = sumDur(spans.filter(s => s.name.startsWith('Service: ')));
    // Network includes response send, any HTTP client spans, and Stripe SDK calls
    const networkMs = sumDur(
      spans.filter(s =>
        s.name === '🌐 HTTP Response Send' ||
        s.name.startsWith('HTTP') ||
        s.name.startsWith('Stripe.')
      )
    );
    const middlewareMs = middlewareSpans.length
      ? Math.max(0, Math.round((Math.max(...middlewareSpans.map(s => s.endTime[0] * 1e9 + s.endTime[1])) - Math.min(...middlewareSpans.map(s => s.startTime[0] * 1e9 + s.startTime[1]))) / 1e6))
      : 0;
    // Do not double count DB under Service; treat DB as a subcomponent line only
    const usedMs = serviceMs + networkMs + middlewareMs;
    const otherMs = Math.max(0, totalMs - usedMs);
    const pct = (ms: number) => totalMs > 0 ? Math.round((ms / totalMs) * 1000) / 10 : 0;
    const bar = (ms: number) => {
      if (totalMs <= 0 || ms <= 0) return '';
      const blocks = Math.floor((ms / totalMs) * 40);
      if (blocks <= 0) return '▌';
      return '█'.repeat(blocks);
    };
    lines.push(((colors.cyan as any).bold)('📊 LATENCY BREAKDOWN'));

    const serviceColor: any = serviceMs >= 300 ? ((colors.red as any).bold) : serviceMs >= 50 ? ((colors.yellow as any).bold) : ((colors.green as any).bold);
    lines.push(serviceColor(` Service:     ${bar(serviceMs)} ${pct(serviceMs)}% (${serviceMs}ms) ${sev(serviceMs)}`));

    const dbCount = Array.from(bestByKey.values()).length;
    if (dbMs > 0) lines.push(colors.cyan(`   └─ Database: ${dbMs}ms across ${dbCount} ${dbCount === 1 ? 'query' : 'queries'}`));
    const bcryptMs = sumDur(spans.filter(s => s.name.toLowerCase().includes('bcrypt')));
    if (bcryptMs > 0) lines.push(colors.cyan(`   └─ bcrypt: ${bcryptMs}ms`));
    const tcpMs = sumDur(spans.filter(s => {
      const n = s.name.toLowerCase();
      return n.includes('tcp') || n.includes('socket') || n.includes('net');
    }));
    if (tcpMs > 0) lines.push(colors.cyan(`   └─ tcp: ${tcpMs}ms`));

    const middlewareColor: any = middlewareMs >= 100 ? ((colors.yellow as any).bold) : ((colors.green as any).bold);
    lines.push(middlewareColor(` Middleware:  ${bar(middlewareMs)} ${pct(middlewareMs)}% (${middlewareMs}ms)`));

    const networkColor: any = networkMs >= 200 ? ((colors.yellow as any).bold) : ((colors.green as any).bold);
    lines.push(networkColor(` Network:     ${bar(networkMs)} ${pct(networkMs)}% (${networkMs}ms)`));

    lines.push(colors.gray(` Other:       ${bar(otherMs)} ${pct(otherMs)}% (${otherMs}ms)`));

    try {
      logger.info(lines.join('\n'));
    } catch {
      // eslint-disable-next-line no-console
      console.log(lines.join('\n'));
    }
  }
}

// Initialize SDK once at process start
if (NodeSDK && Resource && SemanticResourceAttributes && getNodeAutoInstrumentations) {
  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'my-service',
    }),
    instrumentations: [getNodeAutoInstrumentations()],
    spanProcessor: new SimpleSpanProcessor(new TimelineConsoleExporter()),
  });

  // Start immediately
  try {
    const startResult: any = (sdk as any).start?.();
    if (startResult && typeof startResult.catch === 'function') {
      startResult.catch((err: unknown) => {
        try {
          logger.error('OpenTelemetry init failed', err as any);
        } catch {
          // eslint-disable-next-line no-console
          console.error('OpenTelemetry init failed', err);
        }
      });
    }
  } catch (err) {
    try {
      logger.error('OpenTelemetry init failed', err as any);
    } catch {
      // eslint-disable-next-line no-console
      console.error('OpenTelemetry init failed', err);
    }
  }
} else {
  try {
    logger.info('OpenTelemetry SDK modules not found; skipping auto-instrumentation initialization');
  } catch {
    // eslint-disable-next-line no-console
    console.info('OpenTelemetry SDK modules not found; skipping auto-instrumentation initialization');
  }
}

export {}; // side-effect module
