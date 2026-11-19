import express, { Request } from 'express';
import optionalAuth from '../../middlewares/optionalAuth';
import { KeyResolvers, rateLimit } from '../../middlewares/rateLimit';
import validateRequest from '../../middlewares/validateRequest';
import { PaymentController } from './payment.controller';
import { PaymentValidation } from './payment.validation';

const router = express.Router();

// 20 calls per minute per booking and IP (spec 0002, security model): page reloads fit, and a
// shared terminal wifi does not block other travellers. The limiter runs before validation, so
// only a UUID shaped id goes into the key; anything else shares one bucket per IP. That keeps
// huge or random ids from growing the cache or slipping past the limit.
const PAYMENT_MAX_PER_MINUTE = 20;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bookingAndIp =
  (pick: (req: Request) => unknown) =>
  (req: Request): string => {
    const bookingId = pick(req);
    const bookingKey =
      typeof bookingId === 'string' && UUID_SHAPE.test(bookingId) ? bookingId : 'invalid';
    // KeyResolvers.ip canonicalises the client address, so an IPv6 mapped IPv4
    // (::ffff:127.0.0.1) cannot buy a second bucket for the same caller.
    return `${bookingKey}:${KeyResolvers.ip(req)}`;
  };

const paymentLimiter = (routeName: string, pick: (req: Request) => unknown) =>
  rateLimit({
    routeName,
    window: '1m',
    rules: [{ key: 'booking-ip', max: PAYMENT_MAX_PER_MINUTE, resolver: bookingAndIp(pick) }],
  });

// Stripe webhook (spec 0002, AC-7). app.ts gives this path a raw body parser so the signature
// can be checked against the exact bytes. No other body parser, auth or rate limiter may run here:
// only the Stripe-Signature is trusted, and Stripe retries on its own.
router.post('/webhook', PaymentController.handleWebhook);

router.post(
  '/intent',
  paymentLimiter('payment-intent', req => req.body?.bookingId),
  optionalAuth,
  validateRequest(PaymentValidation.createPaymentIntentZodSchema),
  PaymentController.createPaymentIntent,
);

router.post(
  '/:bookingId/sync',
  paymentLimiter('payment-sync', req => req.params.bookingId),
  optionalAuth,
  validateRequest(PaymentValidation.syncPaymentZodSchema),
  PaymentController.syncPayment,
);

export const PaymentRoutes = router;
