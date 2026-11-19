import { PaymentProvider, PaymentStatus, RefundStatus, Role } from '@prisma/client';
import Stripe from 'stripe';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { stripeHolder, createRefund } = vi.hoisted(() => {
  const createRefund = vi.fn();
  return {
    createRefund,
    stripeHolder: { client: { refunds: { create: createRefund } } as unknown },
  };
});

vi.mock('../../../../config/stripe', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../config/stripe')>()),
  get stripe() {
    return stripeHolder.client;
  },
}));

import app from '../../../../app';
import { EmailService } from '../../../../helpers/email';
import { logger } from '../../../../shared/logger';
import {
  bookingPayload,
  createBookableTrip,
  createUser,
  prisma,
  resetDb,
  tokenFor,
} from '../../../../../test/integration/helpers';

/**
 * Spec 0004: refund retry (AC-21), the failed refund state (AC-18), and the change emails
 * (AC-17), against a real Postgres with Stripe mocked. Run with `npm run test:int`.
 */
const api = () => request(app);
const HOUR = 60 * 60 * 1000;

const stripeRejects = () =>
  new Stripe.errors.StripeInvalidRequestError({
    message: 'Charge has been disputed',
    type: 'invalid_request_error',
    code: 'charge_disputed',
  } as never);

beforeEach(async () => {
  await resetDb();
  createRefund.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A Stripe paid guest booking for 2 adults, departing in `departInHours`. */
async function bookPaid(departInHours: number) {
  const trip = await createBookableTrip({ seats: 10 });
  const payload = bookingPayload(trip.schedule.id, { adults: 2 });
  const res = await api().post('/api/v1/bookings').send(payload);
  expect(res.status).toBe(201);
  await prisma.schedule.update({
    where: { id: trip.schedule.id },
    data: {
      departureTime: new Date(Date.now() + departInHours * HOUR),
      arrivalTime: new Date(Date.now() + departInHours * HOUR + 45 * 60 * 1000),
    },
  });
  const payment = await prisma.payment.update({
    where: { bookingId: res.body.data.id },
    data: {
      provider: PaymentProvider.STRIPE,
      status: PaymentStatus.COMPLETED,
      stripePaymentIntentId: `pi_test_${res.body.data.id}`,
      paidAt: new Date(),
    },
  });
  return { ...trip, booking: res.body.data, email: payload.leadPassengerEmail, payment };
}

/** A self cancel whose refund Stripe rejects: the refund ends FAILED. */
async function cancelWithFailedRefund() {
  const paid = await bookPaid(48);
  createRefund.mockRejectedValueOnce(stripeRejects());
  const cancel = await api()
    .patch(`/api/v1/bookings/${paid.booking.reference}/cancel`)
    .send({ email: paid.email });
  expect(cancel.status).toBe(200);
  const failed = await prisma.refund.findFirstOrThrow({ where: { paymentId: paid.payment.id } });
  expect(failed.status).toBe(RefundStatus.FAILED);
  return { ...paid, failed };
}

describe('POST /refunds/:refundId/retry (AC-21)', () => {
  it('the customer sees the failed state; an admin retry sends a new key and the money goes back', async () => {
    const { booking, email, payment, failed } = await cancelWithFailedRefund();

    const view = await api().get(`/api/v1/bookings/${booking.reference}`).query({ email });
    expect(view.body.data.cancellation.refundState).toBe('FAILED');

    createRefund.mockResolvedValueOnce({ id: 're_retry_ok', status: 'succeeded' });
    const admin = await createUser(Role.ADMIN);
    const res = await api()
      .post(`/api/v1/refunds/${failed.id}/retry`)
      .set('Authorization', `Bearer ${await tokenFor(admin)}`);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      amountCents: payment.amountCents,
      reason: 'CUSTOMER_CANCEL',
      status: 'SUCCEEDED',
    });
    expect(createRefund).toHaveBeenLastCalledWith(
      expect.objectContaining({ amount: payment.amountCents }),
      { idempotencyKey: `refund-retry-${res.body.data.id}` },
    );
    // The first attempt kept the original key.
    expect(createRefund.mock.calls[0][1]).toEqual({
      idempotencyKey: `refund-CUSTOMER_CANCEL-${payment.id}`,
    });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      PaymentStatus.REFUNDED,
    );

    const after = await api().get(`/api/v1/bookings/${booking.reference}`).query({ email });
    expect(after.body.data.cancellation.refundState).toBe('REFUNDED');
  });

  it('409 when the refund did not fail, or nothing is left to refund', async () => {
    const { failed } = await cancelWithFailedRefund();
    const admin = await createUser(Role.ADMIN);
    const auth = `Bearer ${await tokenFor(admin)}`;

    createRefund.mockResolvedValueOnce({ id: 're_ok', status: 'succeeded' });
    const ok = await api().post(`/api/v1/refunds/${failed.id}/retry`).set('Authorization', auth);
    expect(ok.status).toBe(201);

    const notFailed = await api().post(`/api/v1/refunds/${ok.body.data.id}/retry`).set('Authorization', auth);
    expect(notFailed.status).toBe(409);
    expect(notFailed.body.data.code).toBe('REFUND_NOT_FAILED');

    const nothingLeft = await api().post(`/api/v1/refunds/${failed.id}/retry`).set('Authorization', auth);
    expect(nothingLeft.status).toBe(409);
    expect(nothingLeft.body.data.code).toBe('NOTHING_TO_REFUND');
    expect(await prisma.refund.count()).toBe(2);
  });

  it('only admins may retry: operator and customer get 403, an unknown id 404', async () => {
    const { failed, operatorUser } = await cancelWithFailedRefund();
    const user = await createUser(Role.USER);

    for (const actor of [operatorUser, user]) {
      const res = await api()
        .post(`/api/v1/refunds/${failed.id}/retry`)
        .set('Authorization', `Bearer ${await tokenFor(actor)}`);
      expect(res.status).toBe(403);
    }
    const admin = await createUser(Role.ADMIN);
    const missing = await api()
      .post('/api/v1/refunds/00000000-0000-4000-8000-000000000000/retry')
      .set('Authorization', `Bearer ${await tokenFor(admin)}`);
    expect(missing.status).toBe(404);
  });
});

describe('change emails (AC-17)', () => {
  it('a new request emails the lead passenger and the ferry owner operator', async () => {
    const sent = vi.spyOn(EmailService, 'sendEmailOrThrow').mockResolvedValue();
    const { booking, email, operatorUser } = await bookPaid(5);

    const res = await api()
      .post(`/api/v1/bookings/${booking.reference}/requests`)
      .send({ type: 'CANCEL', email, reason: '<b>sick</b>' });
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(2));
    const recipients = sent.mock.calls.map(([options]) => options.to);
    expect(recipients).toEqual(expect.arrayContaining([email, operatorUser.email]));
    // The customer's note is escaped, never injected as HTML.
    expect(sent.mock.calls[0][0].html).toContain('&lt;b&gt;sick&lt;/b&gt;');
  });

  it('a mail failure is logged and the cancel stays applied', async () => {
    vi.spyOn(EmailService, 'sendEmailOrThrow').mockRejectedValue(new Error('SMTP down'));
    const logged = vi.spyOn(logger, 'error');
    const { booking, email } = await bookPaid(48);
    createRefund.mockResolvedValueOnce({ id: 're_mail', status: 'succeeded' });

    const res = await api().patch(`/api/v1/bookings/${booking.reference}/cancel`).send({ email });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('self cancel refund')),
    );
  });

  it('a self cancel with a refund emails the lead passenger the refunded amount', async () => {
    const sent = vi.spyOn(EmailService, 'sendEmailOrThrow').mockResolvedValue();
    const { booking, email } = await bookPaid(48);
    createRefund.mockResolvedValueOnce({ id: 're_self', status: 'succeeded' });

    const res = await api().patch(`/api/v1/bookings/${booking.reference}/cancel`).send({ email });

    expect(res.status).toBe(200);
    // The cancel email (spec 0004), and since Stripe settled the refund at once, the refund
    // issued email too (feature 7, spec 0005). Both go to the lead passenger with the amount.
    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(2));
    const subjects = sent.mock.calls.map(([options]) => options.subject);
    expect(subjects).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Your booking is cancelled/), expect.stringMatching(/^Your refund was issued/)]),
    );
    for (const [options] of sent.mock.calls) {
      expect(options.to).toBe(email);
      expect(options.html).toContain('$80.00');
    }
  });

  it('a direct staff move emails the lead passenger the new trip and the escaped note', async () => {
    const sent = vi.spyOn(EmailService, 'sendEmailOrThrow').mockResolvedValue();
    const { booking, email, schedule, route, ferry, operatorUser } = await bookPaid(48);
    const departure = new Date(Date.now() + 72 * HOUR);
    const target = await prisma.schedule.create({
      data: {
        routeId: route.id,
        ferryId: ferry.id,
        departureTime: departure,
        arrivalTime: new Date(departure.getTime() + 45 * 60 * 1000),
        adultFare: 40,
        childFare: 20,
        availableSeats: 10,
      },
    });
    expect(target.id).not.toBe(schedule.id);

    const res = await api()
      .post(`/api/v1/bookings/${booking.reference}/move`)
      .set('Authorization', `Bearer ${await tokenFor(operatorUser)}`)
      .send({ outboundScheduleId: target.id, reason: 'Missed <the> 8:00' });

    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    expect(sent.mock.calls[0][0].to).toBe(email);
    expect(sent.mock.calls[0][0].subject).toContain('Your trip was changed');
    expect(sent.mock.calls[0][0].html).toContain('Missed &lt;the&gt; 8:00');
  });

  it('a staff resolve emails the lead passenger with the staff note', async () => {
    const sent = vi.spyOn(EmailService, 'sendEmailOrThrow').mockResolvedValue();
    const { booking, email, operatorUser } = await bookPaid(5);
    const created = await api()
      .post(`/api/v1/bookings/${booking.reference}/requests`)
      .send({ type: 'CANCEL', email });
    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(2));

    const token = `Bearer ${await tokenFor(operatorUser)}`;
    const resolved = await api()
      .patch(`/api/v1/booking-requests/${created.body.data.id}/resolve`)
      .set('Authorization', token)
      .send({ action: 'REJECT', note: 'Sailings are full' });
    expect(resolved.status).toBe(200);
    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(3));
    expect(sent.mock.calls[2][0].to).toBe(email);
    expect(sent.mock.calls[2][0].html).toContain('Sailings are full');
  });
});
