import { Server } from 'socket.io';
import app from './app';
import config from './config';
import { prisma } from './shared/prisma';
import { allowedOrigins } from './app/logging/corsLogger';
import { seedAdmin } from './DB/seedAdmin';
import { socketHelper } from './helpers/socketHelper';
import { errorLogger, logger, notifyCritical } from './shared/logger';
import { CacheHelper } from './app/shared/CacheHelper';
import { startHoldExpiryJob } from './app/modules/payment/holdExpiry.job';
import {
  generateStartupSummary,
  type StartupStatus,
} from './shared/startupSummary';
import { createSpinner } from './shared/spinnerHelper';

let server: any;

setupGlobalErrorHandlers();

async function main() {
  try {
    const startupStatus = getInitialStartupStatus();

    await connectToDatabase(startupStatus);
    // Spec 0002: frees seats of unpaid holds every minute (off only in NODE_ENV=test).
    startHoldExpiryJob();
    await seedSystemData();
    initializeCache(startupStatus);
    await validatePerformanceThresholds();

    const { port, host } = getServerConfig();
    startServer(port, host, startupStatus);
  } catch (error) {
    handleStartupError(error);
  }
}

main();

function setupGlobalErrorHandlers() {
  process.on('uncaughtException', error => {
    errorLogger.error('UncaughtException Detected', error);
    gracefulShutdown(1);
  });

  process.on('unhandledRejection', error => {
    if (server) {
      errorLogger.error('❌ UnhandledRejection Detected');
      notifyCritical(
        'Unhandled Rejection',
        (error as Error)?.message || 'Unknown error',
      );
      gracefulShutdown(1);
    } else {
      errorLogger.error(
        '❌ UnhandledRejection Detected before server start',
        error,
      );
      process.exit(1);
    }
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM RECEIVED');
    gracefulShutdown(0);
  });
}

function gracefulShutdown(code: number) {
  if (server && typeof server.close === 'function') {
    try {
      server.close(() => setTimeout(() => process.exit(code), 500));
    } catch (e) {
      setTimeout(() => process.exit(code), 500);
    }
  } else {
    process.exit(code);
  }
}

function getInitialStartupStatus(): Partial<StartupStatus> {
  return {
    environment: config.node_env || 'unknown',
    debugMode: config.node_env === 'development',
    rateLimit: true,
    socketIO: false,
    database: { status: 'disconnected' },
    cache: { status: 'disabled' },
  };
}

async function connectToDatabase(startupStatus: Partial<StartupStatus>) {
  const prismaSpinner = createSpinner({
    text: 'Connecting to PostgreSQL via Prisma...',
    color: 'cyan',
  });
  try {
    await prisma.$connect();
    prismaSpinner.succeed('PostgreSQL (Prisma) connected successfully');
    startupStatus.database = {
      status: 'connected',
      message: 'PostgreSQL (Prisma) connected successfully',
    };
  } catch (prismaError) {
    prismaSpinner.fail('PostgreSQL (Prisma) connection failed');
    throw prismaError;
  }
}

async function seedSystemData() {
  const seedSpinner = createSpinner({
    text: 'Verifying admin account & system seeds...',
    color: 'cyan',
  });
  try {
    await seedAdmin();
    seedSpinner.succeed('Admin & system seeds ready');
  } catch (err) {
    seedSpinner.fail('Seed verification failed');
    logger.error('Seed verification error:', err);
  }
}

function initializeCache(startupStatus: Partial<StartupStatus>) {
  const cacheSpinner = createSpinner({
    text: 'Initializing cache system...',
    color: 'cyan',
  });
  CacheHelper.getInstance();
  cacheSpinner.succeed('In-memory cache initialized');
  startupStatus.cache = {
    status: 'initialized',
    message: 'In-memory cache ready',
  };
}

async function validatePerformanceThresholds() {
  if (!config.tracing?.performance?.enabled) return;

  const thresholdSpinner = createSpinner({
    text: 'Validating performance thresholds...',
    color: 'cyan',
  });
  try {
    const { validateAndWarnThresholds } =
      await import('./app/logging/thresholdValidator');
    validateAndWarnThresholds(config.tracing.performance.thresholds);
    thresholdSpinner.succeed('Performance config validated');
  } catch (err) {
    thresholdSpinner.warn('Threshold validation skipped');
    errorLogger.error('Threshold validation failed:', err);
  }
}

function getServerConfig() {
  const port = Number(config.port) || 5001;
  const host =
    config.node_env === 'development'
      ? '0.0.0.0'
      : (config.ip_address && String(config.ip_address).trim()) || '0.0.0.0';
  return { port, host };
}

function startServer(
  port: number,
  host: string,
  startupStatus: Partial<StartupStatus>,
) {
  const serverSpinner = createSpinner({
    text: `Starting HTTP server on ${host}:${port}...`,
    color: 'cyan',
  });

  server = app.listen(port, host, () => {
    const url = `http://${host}:${port}/`;
    serverSpinner.succeed(`Server is listening at ${url}`);
    startupStatus.server = { url, host, port };

    setupSocketIO(startupStatus);

    printStartupSummary(startupStatus);
  });

  setupPortRetryLogic(port, host);
}

function setupSocketIO(startupStatus: Partial<StartupStatus>) {
  const socketSpinner = createSpinner({
    text: 'Initializing Socket.IO server...',
    color: 'cyan',
  });
  const io = new Server(server, {
    pingTimeout: 60000,
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });
  socketHelper.socket(io);
  global.io = io;
  socketSpinner.succeed('Socket.IO ready for real-time connections');
  startupStatus.socketIO = true;
}

function printStartupSummary(startupStatus: Partial<StartupStatus>) {
  startupStatus.timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const summary = generateStartupSummary(startupStatus as StartupStatus, {
    style: 'compact',
    borderStyle: 'double',
    width: 63,
    colors: true,
  });

  console.log('\n' + summary + '\n');
}

function setupPortRetryLogic(port: number, host: string) {
  let portRetries = 0;
  server.on('error', (err: any) => {
    if (err && err.code === 'EADDRINUSE') {
      portRetries++;
      if (portRetries > 5) {
        errorLogger.error(
          `❌ Port ${host}:${port} permanently blocked after 5 retries. Exiting.`,
        );
        process.exit(1);
      }
      errorLogger.error(
        `⚠️ Port in use ${host}:${port} (EADDRINUSE) - Retry ${portRetries}/5`,
      );
      try {
        server.close(() => {
          setTimeout(() => {
            server = app.listen(port, host, () => {
              logger.info(`♻️ Re-listened on ${host}:${port} after EADDRINUSE`);
            });
          }, 1000);
        });
      } catch (closeErr) {
        errorLogger.error(
          'Failed to close server after EADDRINUSE',
          closeErr as any,
        );
      }
    }
  });
}

function handleStartupError(error: unknown) {
  errorLogger.error('❌ Database connection failed');
  notifyCritical(
    'Database Connection Failed',
    (error as Error)?.message || 'Unknown error',
  );
}
