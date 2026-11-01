import Stripe from 'stripe';

// Initialize Stripe only if secret key is provided
const stripeKey = process.env.STRIPE_SECRET_KEY;

export const stripe = stripeKey
  ? new Stripe(stripeKey, {
      apiVersion: '2025-07-30.basil' as Stripe.LatestApiVersion,
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

// Stripe configuration object
export const stripeConfig = {
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  minimumAmount: Number(process.env.MINIMUM_PAYMENT_AMOUNT) || 5.0,
  maximumAmount: Number(process.env.MAXIMUM_PAYMENT_AMOUNT) || 10000.0,
};
