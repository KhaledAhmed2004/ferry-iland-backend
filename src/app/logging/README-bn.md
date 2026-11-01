# Logging Folder (Bangla Guide)

এই `src/app/logging/` ফোল্ডারটি আপনার অ্যাপের request-time logging, per-request metrics, client info enrichment এবং auto-labeling (Controller/Service) পরিচালনা করে। Minimal consolidation অনুসারে এখানে কোর কম্পোনেন্টগুলো একসাথে রাখা হয়েছে যাতে মেইনটেইন ও ডিবাগ করা সহজ হয়।

## কী আছে (Components)
- `requestContext.ts`: `AsyncLocalStorage`-ভিত্তিক per-request context এবং metrics store
  - Labels: `setControllerLabel()`, `setServiceLabel()`, `getLabels()`
  - Metrics: `recordDbQuery()`, `recordCacheHit()`, `recordCacheMiss()`, `recordExternalCall()`, `getMetrics()`
- `requestLogger.ts`: সুন্দর ফরম্যাটে request/response + metrics প্রিন্ট করে (Emoji + categories)
- `clientInfo.ts`: Client Hints + UA fallback দিয়ে OS/Device/Arch/Bitness/Browser detect করে
- `autoLabelBootstrap.ts`: Controller/Service methods wrapper — call হলেই label set করে
- `mongooseMetrics.ts`: Global Mongoose plugin — query/aggregate/save timing + `explain('executionStats')` enrichment

## ইন্টিগ্রেশন অর্ডার (src/app.ts)
- সর্বপ্রথম (schema compile হওয়ার আগেই):
  - `import './app/logging/mongooseMetrics'`
- এরপর bootstrap (router bind-এর আগেই):
  - `import './app/logging/autoLabelBootstrap'`
- Middleware order:
  - `app.use(requestContextInit)` → `app.use(clientInfo)` → `app.use(requestLogger)`

উদাহরণ:
```ts
// src/app.ts
import './app/logging/mongooseMetrics';
import './app/logging/autoLabelBootstrap';

import express from 'express';
import { requestContextInit } from './app/logging/requestContext';
import { clientInfo } from './app/logging/clientInfo';
import { requestLogger } from './app/logging/requestLogger';

const app = express();

// Client Hints headers (optional but recommended for better OS/Device detection)
app.use((_, res, next) => {
  res.setHeader(
    'Accept-CH',
    [
      'Sec-CH-UA',
      'Sec-CH-UA-Platform',
      'Sec-CH-UA-Platform-Version',
      'Sec-CH-UA-Mobile',
      'Sec-CH-UA-Model',
      'Sec-CH-UA-Arch',
      'Sec-CH-UA-Bitness',
    ].join(', ')
  );
  res.setHeader(
    'Vary',
    [
      'Sec-CH-UA',
      'Sec-CH-UA-Platform',
      'Sec-CH-UA-Platform-Version',
      'Sec-CH-UA-Mobile',
      'Sec-CH-UA-Model',
      'Sec-CH-UA-Arch',
      'Sec-CH-UA-Bitness',
    ].join(', ')
  );
  res.setHeader(
    'Critical-CH',
    ['Sec-CH-UA-Platform', 'Sec-CH-UA-Platform-Version'].join(', ')
  );
  next();
});

app.use(requestContextInit);
app.use(clientInfo);

// ... routes

app.use(requestLogger);
export default app;
```

## কিভাবে কাজ করে (Flow)
- Bootstrap লোড হলে Controllers/Services-এর exported object methods wrap হয় — call হলেই `ControllerName.method` ও `ServiceName.method` context-এ set।
- Global Mongoose plugin সমস্ত query/aggregate/save অপারেশনে timing রেকর্ড করে এবং পরে `explain('executionStats')` চালিয়ে
  - `Docs Examined` (`executionStats.totalDocsExamined`)
  - `nReturned` (`executionStats.nReturned`)
  - `Execution Stage` (`queryPlanner.winningPlan.stage` বা nested `inputStage.stage`)
  - `Index Used` (index name থাকলে সেটি, না থাকলে `INDEX`/`NO_INDEX` map)
  যোগ করে।
- `requestLogger` response finish হলে context থেকে labels + metrics পড়ে সুন্দরভাবে ব্লক আকারে প্রিন্ট করে।

### 📊 Latency Breakdown (নতুন)
- `REQUEST TIMELINE`-এর শুরুতে এখন high-level latency breakdown প্রিন্ট হয়:
  - Categories: `Database`, `Network`, `Service`, `Middleware`, `Other`
  - প্রতিটির পাশে percentage bar (`█`) + `%` + `(Xms)` দেখায়
  - উদাহরণ:
    ```
    📊 LATENCY BREAKDOWN 
     Database:    ████████████████████████████████████ 60.3% (337ms) 🐌 
     Network:     ████████████████ 28.4% (159ms) 
     Service:     ████ 6.8% (38ms) 
     Middleware:  ██ 3.6% (20ms) 
     Other:       ▌ 0.9% (5ms)
    ```
- ক্যালকুলেশন লজিক (approximate but consistent):
  - `Database`: deduplicated DB spans (🗄️) এর duration sum
- `Network`: `🌐 HTTP Response Send` spans এর duration sum
  - Stripe SDK calls (`Stripe.*`) এখন Network-এর অংশ — outgoing API time overall network bucket-এ গণনা হয়
  - `Service`: `Service: ...` spans এর duration sum
  - `Middleware`: aggregated middleware stack duration
  - `Other`: `Total - (Database + Network + Service + Middleware)`
- Bars: total width 40; খুব ছোট হলে `▌` দিয়ে minimal fraction দেখানো হয়।
- `🐌`/`⚠️` severity emoji বড় ms হলে add হয় (threshold: ≥300ms)।

## Metrics API (Quick Reference)
- `recordDbQuery(ms, meta?)`: per-query রেকর্ড
  - `meta.model`, `meta.operation`, `meta.cacheHit`, `meta.docsExamined`, `meta.indexUsed`, `meta.pipeline`, `meta.suggestion`, `meta.nReturned`, `meta.executionStage`
- `recordCacheHit(ms)`, `recordCacheMiss(ms)`: cache performance
- `recordExternalCall(ms)`: external API timing
- `getMetrics()`: পুরো metrics snapshot

Note: সাধারণত manual `recordDbQuery()` লাগবে না — global plugin নিজেই কভার করে। Aggregate pipeline summary দেখাতে চাইলে `pipeline` compact string দিতে পারেন।

## Controller/Service Usage
- Export object pattern follow করুন:
  - Controller: `export const FooController = { methodA, methodB }`
  - Service: `export const FooService = { methodA, methodB }`
- নতুন module add করলে `autoLabelBootstrap.ts`-এ `wrapService('FooService', FooService)` এবং `wrapController('FooController', FooController)` যোগ করুন।
- Fallback map দরকার হলে `requestContext.ts`-এর `BASE_TO_CONTROLLER`-এ base path যোগ করুন (e.g., `messages: 'MessageController'`).

## Client Info (Headers)
- Browser Client Hints ব্যবহার করলে `clientInfo` enriched OS/Device/Arch/Bitness/Browser দেখায়।
- Headers middleware (উপরের উদাহরণ) add করলে ২য় রিকোয়েস্ট থেকে hints আসবে। Postman/curl-এ সাধারণত hints নেই — UA fallback ব্যবহার হবে।

## Portability (Copy-Paste করলে কি লাগবে?)
- যদি আপনি এই `src/app/logging/` ফোল্ডার অন্য প্রজেক্টে কপি-পেস্ট করেন:
  - `app.ts`-এ উপরের Import Order মেনে নিতে হবে।
  - Dependencies:
    - `ua-parser-js` (ব্যবহার হয় `clientInfo.ts`-এ)
    - `mongoose` (plugin-এর জন্য)
    - `express` types (middleware signatures)
  - Optional but recommended:
    - Client Hints headers (উদাহরণ অনুযায়ী)
  - এই ফোল্ডার `src/shared/logger.ts` এর উপর নির্ভর করে যদি `requestLogger.ts`-এ `logger` ইউজ করা থাকে — আপনার প্রজেক্টে একটা `shared/logger.ts` বা equivalent logger থাকতে হবে।
    - আমাদের minimal consolidation-এ `shared/logger.ts` আলাদা `src/shared/`-এ আছে (Winston + daily rotate)।
  - TypeScript: সাধারণত ডিফল্ট কনফিগ যথেষ্ট। Node `AsyncLocalStorage` সাপোর্টের জন্য আধুনিক Node (≥ 16) রাখুন।

সংক্ষেপে: কপি-পেস্টের পর `app.ts`-এ দুইটা import (plugin + bootstrap) এবং তিনটা middleware (context → clientInfo → logger) বসালেই কাজ করবে। Client Hints ও `shared/logger` থাকলে enrichment/ফাইল লগিং ফিচারগুলোও সক্রিয় হবে।

## Troubleshooting
- DB metrics `0`:
  - নিশ্চিত করুন `import './app/logging/mongooseMetrics'` ফাইলের একদম উপরে, schema compile হওয়ার আগেই।
- `Model: n/a, Operation: n/a`:
  - Manual `recordDbQuery()` মেটাডাটা ছাড়া কল হলে এমন হতে পারে; সাধারণত plugin-ই যথেষ্ট।
- Client info লাইন দেখাচ্ছে না:
  - Headers middleware আছে কিনা এবং `clientInfo` `requestLogger`-এর আগে আছে কিনা দেখুন।
- Port conflict:
  - পুরোনো dev server চললে নতুনটি চালু হতে পারবে না; বিদ্যমান সার্ভারেই হট রিলোড হবে।

### Latency Breakdown troubleshoot
- Breakdown সবসময় `Total`-এর সাথে মিলবে (sum-clipped): `Other = Total - (others)`।
- যদি `Database` বার না আসে:
  - নিশ্চিত করুন DB dedup logic কাজ করছে (🗄️ spans প্রিন্ট হচ্ছে)।
- `Network` কম দেখালে:
  - `HTTP Response Send` span আছে কিনা দেখুন (auto-instrumentation দরকার হতে পারে)।
  - Stripe calls (`Stripe.*`) patch লোড হয়েছে কিনা নিশ্চিত করুন (`import './app/logging/patchStripe'`)

## Error Lifecycle & Summary (নতুন)
- Timeline লাইনে এখন lifecycle tags দেখানো হয়:
  - Controller: `[START]` → `[COMPLETE]`
  - Service: `[CALL]` → `[RETURN]`
  - Database: `[QUERY_START]` → `[QUERY_COMPLETE]`
  - Response Send: `[SEND]`
  - Validation: `[VALIDATE]` (single event)
  - Stripe SDK: `[CALL]` → `[RESULT]`
  - Others: duration-ভিত্তিক `[EXECUTE]` বা `[EXECUTE_START]` → `[EXECUTE_COMPLETE]`
- Error ঘটলে:
  - যে span-এ exception রেকর্ড হয়েছে, তার নিচে inline details প্রিন্ট হয়:
    - `🚨 <type>: <message>`
    - `📍 Layer: <Controller/Service/Middleware/Database/Network>`
    - `📂 File: <file.ts:line>` (stacktrace থেকে প্রথম ম্যাচ)
    - `🔍 Stack: <first stack frame>`
  - Completion line পরিবর্তিত হয়:
    - Success: `✅ Request Completed Successfully (Total: Xms)`
    - Failure: `❌ Request Failed with Error (Total: Xms)`
  - শেষে একটি `ERROR SUMMARY` ব্লক আসে (earliest exception ভিত্তিক):
    - `❌ Status: <http.status_code>` (HTTP server span attributes থেকে)
    - `🏷️ Type`, `📍 Layer`, `⏱️ Failed at`, `📂 Source`, `💬 Message`

### উদাহরণ
```
⏱️  REQUEST TIMELINE (Total: 34ms)
├─ [22ms] ✅ Validation [VALIDATE] - 1ms
├─ [23ms] ❌ Validation [ERROR] - 1ms 🔴
│  🚨 ValidationError: Missing required field 'email'
│  📍 Layer: Middleware > Validation
│  📂 File: user.validation.ts:15
│  🔍 Stack: at validateUserDTO (user.validation.ts:15:12)
└─ [34ms] ❌ Request Failed with Error (Total: 34ms)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 ERROR SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ Status: 400 Bad Request
🏷️  Type: ValidationError
📍 Layer: Middleware > Validation
⏱️  Failed at: 23ms (67.6% into request)
📂 Source: user.validation.ts:15
💬 Message: Missing required field 'email'

📊 LATENCY BREAKDOWN
 Database:    0% (0ms)
 Network:     0% (0ms)
 Service:     0% (0ms)
 Middleware:  ████████████████████████ 61.8% (21ms)
 Other:       ███████████████ 38.2% (13ms)
```

## Stripe Global Logging (নতুন)
- `src/app/logging/patchStripe.ts` Stripe SDK methods globally wrap করে spans emit করে:
  - `accounts.create/retrieve/del/list`, `accountLinks.create`
  - `paymentIntents.create/retrieve/capture/cancel`
  - `transfers.create`, `refunds.create`
  - `webhookEndpoints.list`, `webhooks.constructEvent`
- Startup import: `import './app/logging/patchStripe'` (`src/app.ts`)
- Logs-এ label হবে: `💳 Stripe: paymentIntents.create [CALL]` → `[RESULT]`
- Webhook verify step-ও cover: `Stripe.webhooks.constructEvent`

## Summary
- এক জায়গায় logging + metrics + labeling রাখা হয়েছে।
- Import order ঠিক রাখলে এবং ছোটখাটো ডিপেন্ডেন্সি ইনস্টল থাকলে, অন্য প্রজেক্টেও খুব কম কনফিগে কাজ করবে।


কপি-পেস্ট করলে অতিরিক্ত কনফিগ লাগবে কি না?

- ন্যূনতমভাবে:
  - app.ts -এ উপরের দুইটা import এবং তিনটা middleware বসালেই কাজ করবে।
  - ua-parser-js , mongoose , express টাইপস ইনস্টল থাকলে ভালো।
  - Client Hints হেডার যোগ করলে OS/Device enrichment সক্রিয় হবে (প্রয়োজনে বাদও দিতে পারেন — তখন UA fallback চলবে)।
  - যদি requestLogger.ts আপনার প্রজেক্টে shared/logger.ts ব্যবহার করে থাকে, তাহলে সেখানে Winston-ভিত্তিক logger থাকা দরকার। আমাদের প্রজেক্টে এটা src/shared/logger.ts -এ আছে; একইরকম বা সমতুল্য logger থাকলেই হবে।
সংক্ষেপে: এই ফোল্ডার অন্য জায়গায় কপি-পেস্ট করলে, খুব কম সেটআপে কাজ করবে — শুধু import order ঠিক রাখুন, প্রয়োজনীয় ডিপেন্ডেন্সি ( ua-parser-js , mongoose ) থাকুক, আর shared/logger থাকলে লগিং আরও সমৃদ্ধ হবে।

## CORS লগিং (Blocked/Allowed দ্রুত ধরা)
- লক্ষ্য: কোন `Origin` allow হচ্ছে আর কোনটা block হচ্ছে — console/file লগে পরিষ্কার দেখা, যাতে দ্রুত সমস্যা শনাক্ত করা যায়।
- লোকেশন: `src/app/logging/corsLogger.ts`
  - `allowedOrigins`: যেগুলো allow করা হবে সেই origin list (সম্পাদনাযোগ্য)
  - `maybeLogCors(origin, allowed)`: rate-limited (প্রতি origin প্রতি ৬০ সেকেন্ডে একবার) allow/block লগ করে
- ইন্টিগ্রেশন: `src/app.ts`
  - Import করুন: `import { allowedOrigins, maybeLogCors } from './app/logging/corsLogger';`
  - `cors({ origin })` callback-এ ব্যবহার করুন:
    ```ts
    origin: (origin, callback) => {
      if (!origin) { // Postman/mobile/native
        maybeLogCors(origin, true);
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        maybeLogCors(origin, true);
        callback(null, true);
      } else {
        maybeLogCors(origin, false);
        callback(new Error('Not allowed by CORS'));
      }
    }
    ```
- ডিবাগ অন করতে: `.env`-এ `CORS_DEBUG=true` বা `CORS_DEBUG=1`
  - লগ উদাহরণ:
    - Allow হলে: `CORS allow: http://localhost:5173`
    - Block হলে: `CORS block: https://example.com`
- Global error handler (`globalErrorHandler.ts`) CORS block হলে ৪০৩ দেয় এবং helpful message দেয়; সঙ্গে `X-CORS-Blocked: 1` header ও `Vary: Origin` সেট করে।
- টিপস:
  - নতুন ফ্রন্টএন্ড URL যোগ করতে হলে `corsLogger.ts`-এর `allowedOrigins`-এ add করুন।
  - যদি ব্রাউজারে preflight fail হয়, Network tab-এ `OPTIONS` রিকোয়েস্ট চেক করুন। আমাদের সেটআপে `app.options('*', cors({...}))` প্রি-ফ্লাইট সাপোর্ট করে।

### দ্রুত ট্রাবলশুটিং চেকলিস্ট
- ফ্রন্টএন্ড কোন URL থেকে হিট করছে? সেই URL `allowedOrigins`-এ আছে তো?
- `CORS_DEBUG` চালু আছে? Block/Allow লগ আসছে কি?
- Response headers-এ `X-CORS-Blocked: 1` দেখা যাচ্ছে? তাহলে origin add করতে হবে।
- Proxy/CDN থাকলে `Origin` হেডার আসলটা retain হচ্ছে কি না দেখুন।
