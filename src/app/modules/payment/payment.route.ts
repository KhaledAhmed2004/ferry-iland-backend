import express, { Request } from 'express';
import optionalAuth from '../../middlewares/optionalAuth';
import { rateLimitMiddleware } from '../../middlewares/rateLimit';
import validateRequest from '../../middlewares/validateRequest';
import { PaymentController } from './payment.controller';
import { PaymentValidation } from './payment.validation';

const router = express.Router();

// 20 calls per minute per booking and IP (spec 0002, security model): page reloads fit, and a
// shared terminal wifi does not block other travellers. The limiter runs before validation, so
// only a UUID shaped id goes into the key; anything else shares one bucket per IP. That keeps
// huge or random ids from growing the cache or slipping past the limit.
const PAYMENT_RATE_LIMIT = { windowMs: 60 * 1000, max: 20 };
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bookingAndIp =
  (pick: (req: Request) => unknown) =>
  (req: Request): string => {
    const bookingId = pick(req);
    const bookingKey =
      typeof bookingId === 'string' && UUID_SHAPE.test(bookingId) ? bookingId : 'invalid';
    return `${bookingKey}:${req.ip}`;
  };

// Stripe webhook (spec 0002, AC-7). app.ts gives this path a raw body parser so the signature
// can be checked against the exact bytes. No other body parser, auth or rate limiter may run here:
// only the Stripe-Signature is trusted, and Stripe retries on its own.
router.post('/webhook', PaymentController.handleWebhook);

router.post(
  '/intent',
  rateLimitMiddleware({
    ...PAYMENT_RATE_LIMIT,
    routeName: 'payment-intent',
    keyResolver: bookingAndIp(req => req.body?.bookingId),
  }),
  optionalAuth,
  validateRequest(PaymentValidation.createPaymentIntentZodSchema),
  PaymentController.createPaymentIntent,
);

router.post(
  '/:bookingId/sync',
  rateLimitMiddleware({
    ...PAYMENT_RATE_LIMIT,
    routeName: 'payment-sync',
    keyResolver: bookingAndIp(req => req.params.bookingId),
  }),
  optionalAuth,
  validateRequest(PaymentValidation.syncPaymentZodSchema),
  PaymentController.syncPayment,
);

export const PaymentRoutes = router;
