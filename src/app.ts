import path from 'path';
import cors from 'cors';
import './app/logging/autoLabelBootstrap';
import './app/logging/opentelemetry';
import './app/logging/patchBcrypt';
import './app/logging/patchJWT';
import './app/logging/patchStripe';
import router from './routes';
import { Morgan } from './shared/morgen';
import { StatusCodes } from 'http-status-codes';
import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import globalErrorHandler from './app/middlewares/globalErrorHandler';
import { requestContextInit } from './app/logging/requestContext';
import { clientInfo } from './app/logging/clientInfo';
import { requestLogger } from './app/logging/requestLogger';
import { otelExpressMiddleware } from './app/logging/otelExpress';
import { allowedOrigins, maybeLogCors } from './app/logging/corsLogger';

const app = express();

// Trust reverse proxy (AWS ALB, Cloudflare, Nginx) for accurate client IP resolution in rate limiters
app.set('trust proxy', 1);

app.use(Morgan.successHandler);
app.use(Morgan.errorHandler);

app.use((req, res, next) => {
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
    ].join(', '),
  );

  const varyHeaders = [
    'User-Agent',
    'Sec-CH-UA',
    'Sec-CH-UA-Platform',
    'Sec-CH-UA-Platform-Version',
    'Sec-CH-UA-Mobile',
    'Sec-CH-UA-Model',
    'Sec-CH-UA-Arch',
    'Sec-CH-UA-Bitness',
  ].join(', ');
  const existingVary = res.getHeader('Vary');
  res.setHeader(
    'Vary',
    existingVary ? String(existingVary) + ', ' + varyHeaders : varyHeaders,
  );

  res.setHeader(
    'Critical-CH',
    [
      'Sec-CH-UA-Platform',
      'Sec-CH-UA-Platform-Version',
      'Sec-CH-UA-Mobile',
      'Sec-CH-UA-Model',
    ].join(', '),
  );

  next();
});

app.use(otelExpressMiddleware);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
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
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  }),
);

app.options(
  '*',
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  }),
);

app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));

app.use((req, res, next) => {
  if (req.path.includes('/webhook')) {
    return next();
  }
  express.json({ limit: '10mb' })(req, res, next);
});

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(requestContextInit);
app.use(clientInfo);
app.use(requestLogger);

app.use('/uploads', express.static('uploads'));

app.use('/api/v1', router);

app.get('/', (req: Request, res: Response) =>
  res.sendFile(path.join(__dirname, '../public/live-response.html')),
);

app.use(globalErrorHandler);

app.use((req, res) => {
  res.status(StatusCodes.NOT_FOUND).json({
    success: false,
    message: 'Not found',
    errorMessages: [
      {
        path: req.originalUrl,
        message: "API DOESN'T EXIST",
      },
    ],
  });
});

export default app;
