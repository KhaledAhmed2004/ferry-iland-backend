-- Spec 0002: last processing error for a Stripe webhook event (AC-11).
ALTER TABLE "StripeWebhookEvent" ADD COLUMN "error" TEXT;
