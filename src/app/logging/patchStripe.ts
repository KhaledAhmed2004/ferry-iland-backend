/*
  Global Stripe instrumentation patch
  - Wraps commonly used Stripe SDK resource methods to emit OpenTelemetry spans
  - Lives in logging folder and loads once during app bootstrap
  - No changes needed in services/controllers — calls remain the same
*/
import { trace } from '@opentelemetry/api';
import { stripe } from '../../config/stripe';

// Lightweight sanitizer to avoid leaking secrets in span attributes
const sanitize = (value: any): any => {
  try {
    return JSON.parse(
      JSON.stringify(value, (key, val) => {
        const k = String(key).toLowerCase();
        if (!key) return val;
        if (k.includes('secret') || k.includes('client_secret') || k.includes('api_key') || k.includes('password')) {
          return '[redacted]';
        }
        return val;
      })
    );
  } catch {
    return undefined;
  }
};

const tracer = trace.getTracer('app');

function wrapMethod(resource: any, methodName: string, resourceLabel: string) {
  if (!resource || typeof resource[methodName] !== 'function') return;
  const original = resource[methodName].bind(resource);
  resource[methodName] = function patchedStripeMethod(...args: any[]) {
    const opName = `Stripe.${resourceLabel}.${methodName}`;
    return tracer.startActiveSpan(opName, span => {
      const start = Date.now();
      try {
        // Attach minimal request attributes (sanitized)
        try { span.setAttribute('stripe.resource', resourceLabel); } catch {}
        try { span.setAttribute('stripe.method', methodName); } catch {}
        try { span.setAttribute('stripe.request', sanitize(args)); } catch {}

        const out = original(...args);
        if (out && typeof out.then === 'function') {
          return (out as Promise<any>)
            .then(res => {
              try { span.setAttribute('stripe.ms', Date.now() - start); } catch {}
              try { if (res && res.id) span.setAttribute('stripe.result.id', String(res.id)); } catch {}
              try { span.setAttribute('stripe.status', 'ok'); } catch {}
              try { span.end(); } catch {}
              return res;
            })
            .catch(err => {
              try { span.recordException(err as any); } catch {}
              try { span.setAttribute('stripe.ms', Date.now() - start); } catch {}
              try { span.setAttribute('stripe.status', 'error'); } catch {}
              try { span.end(); } catch {}
              throw err;
            });
        }
        // Non-promise path (rare for Stripe SDK)
        try { span.setAttribute('stripe.ms', Date.now() - start); } catch {}
        try { span.setAttribute('stripe.status', 'ok'); } catch {}
        try { span.end(); } catch {}
        return out;
      } catch (err) {
        try { span.recordException(err as any); } catch {}
        try { span.end(); } catch {}
        throw err;
      }
    });
  };
}

try {
  // Avoid double-patching in dev hot-reload
  if (!(stripe as any).__otel_stripe_patched) {
    // Accounts
    wrapMethod((stripe as any).accounts, 'create', 'accounts');
    wrapMethod((stripe as any).accounts, 'retrieve', 'accounts');
    wrapMethod((stripe as any).accounts, 'del', 'accounts');
    wrapMethod((stripe as any).accounts, 'list', 'accounts');

    // Account Links
    wrapMethod((stripe as any).accountLinks, 'create', 'accountLinks');

    // Payment Intents
    wrapMethod((stripe as any).paymentIntents, 'create', 'paymentIntents');
    wrapMethod((stripe as any).paymentIntents, 'retrieve', 'paymentIntents');
    wrapMethod((stripe as any).paymentIntents, 'capture', 'paymentIntents');
    wrapMethod((stripe as any).paymentIntents, 'cancel', 'paymentIntents');

    // Transfers
    wrapMethod((stripe as any).transfers, 'create', 'transfers');

    // Refunds
    wrapMethod((stripe as any).refunds, 'create', 'refunds');

    // Webhook endpoints (diagnostics)
    wrapMethod((stripe as any).webhookEndpoints, 'list', 'webhookEndpoints');

    // Webhooks.constructEvent (signature verification)
    if ((stripe as any).webhooks && typeof (stripe as any).webhooks.constructEvent === 'function') {
      const originalConstruct = (stripe as any).webhooks.constructEvent.bind((stripe as any).webhooks);
      (stripe as any).webhooks.constructEvent = function patchedConstructEvent(...args: any[]) {
        return tracer.startActiveSpan('Stripe.webhooks.constructEvent', span => {
          try {
            const evt = originalConstruct(...args);
            try { span.setAttribute('stripe.status', 'ok'); } catch {}
            try { span.end(); } catch {}
            return evt;
          } catch (err) {
            try { span.recordException(err as any); } catch {}
            try { span.setAttribute('stripe.status', 'error'); } catch {}
            try { span.end(); } catch {}
            throw err;
          }
        });
      };
    }

    (stripe as any).__otel_stripe_patched = true;
  }
} catch {}

export {}; // side-effect module
