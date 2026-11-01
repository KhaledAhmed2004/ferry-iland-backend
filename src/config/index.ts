import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });

export default {
  ip_address: process.env.IP_ADDRESS,
  database_url: process.env.DATABASE_URL,
  node_env: process.env.NODE_ENV,
  port: process.env.PORT,
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS,
  otp_secret: process.env.OTP_SECRET || 'default-fallback-secret-change-me',
  frontend_url: process.env.FRONTEND_URL,

  // Spec 0001: when true, bookings start PENDING with a Stripe payment and hold seats until paid.
  // Default false keeps the confirm on create flow with an unpaid MANUAL payment.
  payments: {
    enabled: process.env.PAYMENTS_ENABLED === 'true',
  },

  // Project branding configuration
  app: {
    name: process.env.APP_NAME || 'Educoin Backend',
    tagline: process.env.APP_TAGLINE || 'Enterprise API',
    version: process.env.APP_VERSION || '1.0.0',
  },

  // Startup summary configuration
  startupSummary: {
    enabled: process.env.STARTUP_SUMMARY_ENABLED !== 'false', // Default true
    style: (process.env.STARTUP_SUMMARY_STYLE || 'compact') as
      | 'compact'
      | 'progress'
      | 'minimal',
    showTimestamp: process.env.STARTUP_SUMMARY_TIMESTAMP !== 'false', // Default true
    colors: process.env.STARTUP_SUMMARY_COLORS !== 'false', // Default true
  },

  jwt: {
    jwt_secret: process.env.JWT_SECRET,
    jwt_expire_in: process.env.JWT_EXPIRE_IN,
    jwt_refresh_secret: process.env.JWT_REFRESH_SECRET,
    jwt_refresh_expire_in: process.env.JWT_REFRESH_EXPIRE_IN,
  },
  email: {
    from: process.env.EMAIL_FROM,
    user: process.env.EMAIL_USER,
    port: process.env.EMAIL_PORT,
    host: process.env.EMAIL_HOST,
    pass: process.env.EMAIL_PASS,
  },
  admin: {
    email: process.env.ADMIN_EMAIL || process.env.SUPER_ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD || process.env.SUPER_ADMIN_PASSWORD,
  },
  firebase_api_key_base64: process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64,
  firebase_web_push_credentials: process.env.FIREBASE_WEB_PUSH_CREDENTIALS,

  // Cloudflare R2 / S3-compatible Configuration
  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME,
    s3ApiUrl: process.env.R2_S3_API_URL,
    customDomain: process.env.R2_CUSTOM_DOMAIN,
  },

  // 🆕 NEW: Tracing capture configuration
  tracing: {
    capture: {
      enabled: process.env.TRACE_CAPTURE_ARGS !== 'false', // Default true
      args: process.env.TRACE_CAPTURE_ARGS !== 'false',
      returns: process.env.TRACE_CAPTURE_RETURNS !== 'false',
      maxDepth: parseInt(process.env.TRACE_CAPTURE_MAX_DEPTH || '5'),
      maxArrayItems: parseInt(process.env.TRACE_CAPTURE_MAX_ARRAY_ITEMS || '10'),
      maxStringLength: parseInt(
        process.env.TRACE_CAPTURE_MAX_STRING_LENGTH || '500'
      ),
      maxSizeKB: parseInt(process.env.TRACE_CAPTURE_MAX_SIZE_KB || '5'),
      maskPII: process.env.TRACE_CAPTURE_MASK_PII !== 'false', // Default true
    },

    // 🆕 NEW: Performance monitoring configuration
    performance: {
      enabled: process.env.TRACE_PERF_ENABLED !== 'false', // Default true
      captureMemory: process.env.TRACE_PERF_MEMORY !== 'false',
      captureCPU: process.env.TRACE_PERF_CPU !== 'false',
      captureEventLoop: process.env.TRACE_PERF_EVENT_LOOP !== 'false',
      eventLoopSampleInterval: parseInt(
        process.env.TRACE_PERF_SAMPLE_INTERVAL || '50'
      ), // ms

      // Display options
      showProgressBars: process.env.TRACE_PERF_SHOW_BARS !== 'false',
      showStatusText: process.env.TRACE_PERF_SHOW_STATUS !== 'false',
      showDetailedBreakdown: process.env.TRACE_PERF_DETAILED !== 'false',

      // Custom thresholds (optional - sensible defaults)
      thresholds: {
        memory: {
          healthy: parseInt(process.env.TRACE_PERF_MEM_HEALTHY || '50'), // MB - Normal operations (bcrypt, moderate queries)
          moderate: parseInt(process.env.TRACE_PERF_MEM_MODERATE || '100'), // MB - Heavy operations (file processing)
          high: parseInt(process.env.TRACE_PERF_MEM_HIGH || '200'), // MB - Very heavy (batch, large files)
        },
        cpu: {
          efficient: parseInt(process.env.TRACE_PERF_CPU_EFFICIENT || '50'), // % - Simple operations
          moderate: parseInt(process.env.TRACE_PERF_CPU_MODERATE || '150'), // % - Thread pool use (bcrypt, JWT, crypto)
          intensive: parseInt(process.env.TRACE_PERF_CPU_INTENSIVE || '300'), // % - Heavy crypto, compression
        },
        eventLoop: {
          excellent: parseInt(process.env.TRACE_PERF_LOOP_EXCELLENT || '5'), // ms
          good: parseInt(process.env.TRACE_PERF_LOOP_GOOD || '15'),
          delayed: parseInt(process.env.TRACE_PERF_LOOP_DELAYED || '30'),
        },
      },
    },
  },

  // In-App Purchase (IAP) Configuration
  iap: {
    productId: process.env.IAP_PRODUCT_ID || 'ekkali_premium_yearly',
    appleSharedSecret:
      process.env.APPLE_SHARED_SECRET || 'd80a9f618b89421caa13ca23b2c8c996',
    appleKeyId: process.env.APPLE_KEY_ID || '6GCW7YAAQC',
    appleIssuerId:
      process.env.APPLE_ISSUER_ID || 'f9ed49c4-524c-4933-867e-beff6c0e005d',
    appleTeamId: process.env.APPLE_TEAM_ID || 'L2S8P8TC9Z',
    appleKeyPath:
      process.env.APPLE_KEY_PATH ||
      path.join(process.cwd(), 'keys', 'apple-subscription-key.p8'),
    googlePackageName: process.env.GOOGLE_PACKAGE_NAME || 'com.moeb26.app',
    googleServiceAccountKeyPath:
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ||
      path.join(process.cwd(), 'keys', 'google-service-account.json'),
  },
};

