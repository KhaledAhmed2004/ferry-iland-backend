import { BookingStatus, PaymentStatus, RefundReason, RefundStatus, Role } from '@prisma/client';
import Stripe from 'stripe';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Feature 7 (spec 0005): the payment receipt and the refund issued email, against a real Postgres
 * with the Stripe client stubbed and the mail transport spied. Every path that confirms a booking
 * or settles a refund is driven through its real entry point. Run with `npm run test:int`.
 */
const TEST_SECRET = 'whsec_test_payment_emails';

const { createIntent, retrieveIntent, createRefund } = vi.hoisted(() => ({
  createIntent: vi.fn(),
  retrieveIntent: vi.fn(),
  createRefund: vi.fn(),
}));

vi.mock('../../../../config/stripe', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../config/stripe')>()),
  stripe: {
    paymentIntents: { create: createIntent, retrieve: retrieveIntent },
    refunds: { create: createRefund },
  },
  stripeConfig: { webhookSecret: 'whsec_test_payment_emails' },
}));

import app from '../../../../app';
import config from '../../../../config';
import { EmailService } from '../../../../helpers/email';
import { logger } from '../../../../shared/logger';
import { PaymentService } from '../payment.service';
import {
  bookingPayload,
  createBookableTrip,
  createUser,
  prisma,
  resetDb,
  tokenFor,
  uniq,
} from '../../../../../test/integration/helpers';

const api = () => request(app);
type Mail = { to: string; subject: string; html: string };

const fakeIntent = (overrides: Partial<Stripe.PaymentIntent> = {}) => {
  const id = `pi_test_${uniq()}`;
  return {
    id,
    object: 'payment_intent',
    status: 'requires_payment_method',
    client_secret: `${id}_secret_${uniq()}`,
    amount: 4000,
    amount_received: 0,
    currency: 'usd',
    livemode: false,
    metadata: {},
    last_payment_error: null,
    ...overrides,
  } as Stripe.PaymentIntent;
};

const postSigned = (type: string, object: unknown, id = `evt_test_${uniq()}`) => {
  const payload = JSON.stringify({
    id,
    object: 'event',
    api_version: '2026-10-28.endive',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object },
  });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: TEST_SECRET });
  return api()
    .post('/api/v1/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', header)
    .send(payload);
};

/** A PENDING Stripe booking with its intent, made through the real endpoints. */
const pendingWithIntent = async (opts: { adults?: number; children?: number; name?: string } = {}) => {
  const trip = await createBookableTrip({ seats: 10, adultFare: 40, childFare: 20 });
  const email = `lead-${uniq()}@test.local`;
  const body = {
    ...bookingPayload(trip.schedule.id, { email, adults: opts.adults ?? 1, children: opts.children ?? 0 }),
    ...(opts.name ? { leadPassengerName: opts.name } : {}),
  };
  const created = await api().post('/api/v1/bookings').send(body);
  expect(created.status).toBe(201);
  const booking = created.body.data as { id: string; reference: string };
  const intentRes = await api().post('/api/v1/payments/intent').send({ bookingId: booking.id, email });
  expect(intentRes.status).toBe(200);
  const intent = (await createIntent.mock.results.at(-1)!.value) as Stripe.PaymentIntent;
  const succeeded = { ...intent, status: 'succeeded', amount_received: intent.amount } as Stripe.PaymentIntent;
  return { ...trip, booking, email, intent, succeeded };
};

/** A CONFIRMED booking paid through the webhook, with its receipt already sent and cleared. */
const paidBooking = async () => {
  const ctx = await pendingWithIntent();
  expect((await postSigned('payment_intent.succeeded', ctx.succeeded)).status).toBe(200);
  await vi.waitFor(() => expect(receipts()).toHaveLength(1));
  sent.mockClear();
  return ctx;
};

let sent: ReturnType<typeof vi.fn>;
const mails = () => sent.mock.calls.map(([mail]) => mail as Mail);
const receipts = () => mails().filter(m => m.subject.startsWith('Your IslandHop receipt'));
const refundIssued = () => mails().filter(m => m.subject.startsWith('Your refund was issued'));
const settle = () => new Promise(resolve => setTimeout(resolve, 300));

const refundResponse = (status: string) => async (params: Stripe.RefundCreateParams) => ({
  id: `re_test_${uniq()}`,
  object: 'refund',
  amount: params.amount,
  status,
});

let paymentsWereEnabled: boolean;

beforeAll(() => {
  paymentsWereEnabled = config.payments.enabled;
  config.payments.enabled = true;
});

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  sent = vi.spyOn(EmailService, 'sendEmailOrThrow').mockResolvedValue() as unknown as ReturnType<typeof vi.fn>;
  createIntent.mockImplementation(async (params: Stripe.PaymentIntentCreateParams) =>
    fakeIntent({ amount: params.amount, currency: params.currency, metadata: params.metadata as Stripe.Metadata }),
  );
  createRefund.mockImplementation(refundResponse('pending'));
});

afterAll(async () => {
  config.payments.enabled = paymentsWereEnabled;
  await prisma.$disconnect();
});

describe('payment receipt', () => {
  it('a webhook confirm sends one receipt to the lead passenger with reference, trip, passengers and amount', async () => {
    const { booking, email, succeeded, route } = await pendingWithIntent({ adults: 2, children: 1 });

    const res = await postSigned('payment_intent.succeeded', succeeded);

    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(receipts()).toHaveLength(1));
    const [mail] = receipts();
    expect(mail.to).toBe(email);
    expect(mail.subject).toBe(`Your IslandHop receipt for ${booking.reference}`);
    expect(mail.html).toContain(booking.reference);
    expect(mail.html).toContain('$100.00'); // 2 x 40 + 1 x 20, from Payment.amountCents
    expect(mail.html).toContain('2 adults, 1 child');
    const port = await prisma.port.findUniqueOrThrow({ where: { id: route.departurePortId } });
    expect(mail.html).toContain(port.name);
    expect(mail.html).toContain(`/manage-booking/${booking.reference}`);
    expect(mail.html).not.toContain('Moeb26');
  });

  it('the same event twice, or a second event for the intent, sends no second receipt', async () => {
    const { succeeded } = await pendingWithIntent();
    const eventId = `evt_test_${uniq()}`;

    await postSigned('payment_intent.succeeded', succeeded, eventId);
    await postSigned('payment_intent.succeeded', succeeded, eventId);
    await postSigned('payment_intent.succeeded', succeeded);
    await settle();

    expect(receipts()).toHaveLength(1);
  });

  it('the sync endpoint confirms and sends the receipt once; a repeat sync sends nothing', async () => {
    const { booking, email, succeeded } = await pendingWithIntent();
    retrieveIntent.mockResolvedValue(succeeded);

    const first = await api().post(`/api/v1/payments/${booking.id}/sync`).send({ email });
    const again = await api().post(`/api/v1/payments/${booking.id}/sync`).send({ email });
    await settle();

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(receipts()).toHaveLength(1);
    expect(receipts()[0].to).toBe(email);
  });

  it('sync and webhook racing for the same payment send one receipt', async () => {
    const { booking, email, succeeded } = await pendingWithIntent();
    retrieveIntent.mockResolvedValue(succeeded);

    await Promise.all([
      api().post(`/api/v1/payments/${booking.id}/sync`).send({ email }),
      postSigned('payment_intent.succeeded', succeeded),
    ]);
    await settle();

    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      BookingStatus.CONFIRMED,
    );
    expect(receipts()).toHaveLength(1);
  });

  it('a late payment that takes its seats again sends the receipt', async () => {
    const { booking, succeeded } = await pendingWithIntent();
    await prisma.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.EXPIRED, expiredAt: new Date() } });
    await prisma.payment.update({ where: { bookingId: booking.id }, data: { status: PaymentStatus.CANCELED } });

    const result = await PaymentService.applyIntentResult(succeeded, 'webhook');

    expect(result.outcome).toBe('confirmed');
    await vi.waitFor(() => expect(receipts()).toHaveLength(1));
  });

  it('a declined card sends nothing', async () => {
    const { intent } = await pendingWithIntent();

    await postSigned('payment_intent.payment_failed', {
      ...intent,
      status: 'requires_payment_method',
      last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', message: 'No funds' },
    });
    await settle();

    expect(mails()).toHaveLength(0);
  });

  it('a booking made with payments off (MANUAL, unpaid) gets no receipt', async () => {
    config.payments.enabled = false;
    try {
      const { schedule } = await createBookableTrip();
      const res = await api().post('/api/v1/bookings').send(bookingPayload(schedule.id));
      expect(res.status).toBe(201);
      await settle();
      expect(receipts()).toHaveLength(0);
    } finally {
      config.payments.enabled = true;
    }
  });

  it('the lead name is HTML escaped in the receipt', async () => {
    const { succeeded } = await pendingWithIntent({ name: 'Ann <b>Bold</b>' });

    await postSigned('payment_intent.succeeded', succeeded);

    await vi.waitFor(() => expect(receipts()).toHaveLength(1));
    expect(receipts()[0].html).toContain('Ann &lt;b&gt;Bold&lt;/b&gt;');
    expect(receipts()[0].html).not.toContain('<b>Bold</b>');
  });

  it('a mail failure is logged and the booking stays confirmed', async () => {
    sent.mockRejectedValue(new Error('SMTP down'));
    const logged = vi.spyOn(logger, 'error');
    const { booking, succeeded } = await pendingWithIntent();

    const res = await postSigned('payment_intent.succeeded', succeeded);

    expect(res.status).toBe(200);
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith('Booking email "payment receipt" failed: SMTP down'),
    );
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      BookingStatus.CONFIRMED,
    );
  });
});

describe('refund issued email', () => {
  it('a refund Stripe settles right away sends one email with the refunded amount', async () => {
    createRefund.mockImplementation(refundResponse('succeeded'));
    const { booking, email } = await paidBooking();

    const res = await api().patch(`/api/v1/bookings/${booking.reference}/cancel`).send({ email });

    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(refundIssued()).toHaveLength(1));
    const [mail] = refundIssued();
    expect(mail.to).toBe(email);
    expect(mail.html).toContain('$40.00');
    expect(mail.html).toContain(booking.reference);
    // The cancel email (spec 0004) still goes out as well.
    expect(mails().some(m => m.subject.startsWith('Your booking is cancelled'))).toBe(true);
  });

  it('a pending refund emails only when refund.updated settles it, and only once', async () => {
    const { booking, email } = await paidBooking();
    await api().patch(`/api/v1/bookings/${booking.reference}/cancel`).send({ email });
    await settle();
    expect(refundIssued()).toHaveLength(0);

    const refund = await prisma.refund.findFirstOrThrow({ where: { payment: { bookingId: booking.id } } });
    const update = { id: refund.stripeRefundId, object: 'refund', status: 'succeeded', amount: refund.amountCents };
    await postSigned('refund.updated', update);
    await postSigned('refund.updated', update);
    await settle();

    expect(refundIssued()).toHaveLength(1);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe(RefundStatus.SUCCEEDED);
  });

  it('a refund Stripe rejects sends no refund issued email', async () => {
    createRefund.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', code: 'charge_already_refunded', message: 'Already refunded' }),
    );
    const { booking, email } = await paidBooking();

    await api().patch(`/api/v1/bookings/${booking.reference}/cancel`).send({ email });
    await settle();

    expect((await prisma.refund.findFirstOrThrow({ where: { payment: { bookingId: booking.id } } })).status).toBe(
      RefundStatus.FAILED,
    );
    expect(refundIssued()).toHaveLength(0);
  });

  it('a late payment with no seats left gets the refund email with the reason and no receipt', async () => {
    createRefund.mockImplementation(refundResponse('succeeded'));
    const { booking, schedule, succeeded } = await pendingWithIntent();
    await prisma.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.EXPIRED, expiredAt: new Date() } });
    await prisma.payment.update({ where: { bookingId: booking.id }, data: { status: PaymentStatus.CANCELED } });
    await prisma.schedule.update({ where: { id: schedule.id }, data: { availableSeats: 0 } });

    const res = await postSigned('payment_intent.succeeded', succeeded);

    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(refundIssued()).toHaveLength(1));
    const refund = await prisma.refund.findFirstOrThrow({ where: { payment: { bookingId: booking.id } } });
    expect(refund.reason).toBe(RefundReason.LATE_PAYMENT);
    expect(refundIssued()[0].html).toContain('seat hold');
    expect(receipts()).toHaveLength(0);
  });

  it('an admin direct cancel gets the refund issued email', async () => {
    createRefund.mockImplementation(refundResponse('succeeded'));
    const { booking, email } = await paidBooking();
    const admin = await createUser(Role.ADMIN);

    const res = await api()
      .patch(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${await tokenFor(admin)}`);

    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(refundIssued()).toHaveLength(1));
    expect(refundIssued()[0].to).toBe(email);
    const refund = await prisma.refund.findFirstOrThrow({ where: { payment: { bookingId: booking.id } } });
    expect(refund.reason).toBe(RefundReason.ADMIN);
  });
});
