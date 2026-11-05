import Stripe from 'stripe';

// Initialize Stripe only if secret key is provided
const stripeKey = process.env.STRIPE_SECRET_KEY;

export const stripe = stripeKey
  ? new Stripe(stripeKey, {
      // Pinned to the version this SDK major ships with (spec 0002). Create the webhook
      // endpoint on the same version.
      apiVersion: '2026-10-28.endive',
      typescript: true,
    })
  : (null as unknown as Stripe);

if (!stripeKey) {
  console.warn('⚠️  STRIPE_SECRET_KEY not set — Stripe/payment features will be unavailable.');
}

// Default currency for payments
export const DEFAULT_CURRENCY = 'usd';

// Unit conversion helpers. Commission is read from PlatformSetting (spec 0001), never from env.
export const dollarsToCents = (dollars: number): number => {
  return Math.round(dollars * 100);
};

export const centsToDollars = (cents: number): number => {
  return cents / 100;
};

// Error handling utility
export const handleStripeError = (error: any): string => {
  if (error.type === 'StripeCardError') {
    return `Card error: ${error.message}`;
  } else if (error.type === 'StripeRateLimitError') {
    return 'Rate limit error: Too many requests made to the API too quickly';
  } else if (error.type === 'StripeInvalidRequestError') {
    return `Invalid request: ${error.message}`;
  } else if (error.type === 'StripeAPIError') {
    return "API error: An error occurred internally with Stripe's API";
  } else if (error.type === 'StripeConnectionError') {
    return 'Connection error: A network error occurred';
  } else if (error.type === 'StripeAuthenticationError') {
    return "Authentication error: Authentication with Stripe's API failed";
  } else {
    return `Unknown error: ${error.message || 'Something went wrong'}`;
  }
};

/** Stripe's smallest USD charge. The only amount floor (spec 0002); there is no maximum. */
export const STRIPE_MINIMUM_AMOUNT_CENTS = 50;

/** The only payment method this integration accepts (spec 0002, value sourcing). */
export const ALLOWED_PAYMENT_METHOD_TYPES: Stripe.PaymentIntentCreateParams.AllowedPaymentMethodType[] =
  ['card'];

/** True when the configured key is a live key, so an intent's livemode can be checked against it. */
export const isLiveStripeKey = (): boolean =>
  !!stripeKey && (stripeKey.startsWith('sk_live_') || stripeKey.startsWith('rk_live_'));

// Stripe configuration object. The publishable key lives only in the frontend env.
export const stripeConfig = {
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
};
