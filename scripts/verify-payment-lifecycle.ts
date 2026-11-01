/**
 * Live check for spec 0001 against the configured database. Run: npx tsx scripts/verify-payment-lifecycle.ts
 * It borrows one bookable schedule, restores its seat count, and deletes every row it creates.
 */
import { BookingStatus, PaymentProvider, PaymentStatus, TripStatus } from '@prisma/client';
import { prisma } from '../src/shared/prisma';
import { BookingService } from '../src/app/modules/booking/booking.service';

const results: Array<[string, boolean, string?]> = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);

const passenger = (n: number) => ({
  passengerName: `Verify Passenger ${n}`,
  nationality: 'TEST',
  passportOrId: `VERIFY-${n}`,
});

async function main() {
  const schedule = await prisma.schedule.findFirst({
    where: {
      status: { in: [TripStatus.ON_TIME, TripStatus.PREPARING, TripStatus.BOARDING] },
      adultFare: { gt: 0 },
    },
  });
  if (!schedule) throw new Error('No bookable schedule with a fare found to run the check on.');

  const originalSeats = schedule.availableSeats;
  const createdBookingIds: string[] = [];

  try {
    // AC-4: two bookings race for the last 2 seats, each asking for 2.
    await prisma.schedule.update({ where: { id: schedule.id }, data: { availableSeats: 2 } });
    const attempt = () =>
      BookingService.createBooking(null, {
        scheduleId: schedule.id,
        leadPassengerName: 'Verify Race',
        leadPassengerEmail: 'verify-race@example.com',
        adultsCount: 2,
        childrenCount: 0,
        passengers: [passenger(1), passenger(2)],
      });
    const race = await Promise.allSettled([attempt(), attempt()]);
    const winners = race.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const losers = race.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    winners.forEach(w => createdBookingIds.push(w.value.id));
    const seatsAfterRace = (await prisma.schedule.findUniqueOrThrow({ where: { id: schedule.id } }))
      .availableSeats;
    check(
      'AC-4 seat race: exactly one booking wins, seats end at 0',
      winners.length === 1 && losers.length === 1 && seatsAfterRace === 0,
      `winners=${winners.length} seatsAfter=${seatsAfterRace} loser=${losers[0]?.reason?.message}`,
    );

    // AC-2 / AC-3: flag off by default -> CONFIRMED + MANUAL PENDING, exact cents split.
    const winner = winners[0]?.value;
    if (winner) {
      const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: winner.id } });
      const expectedCents = Math.round(2 * schedule.adultFare * 100);
      check(
        'AC-2/AC-3 booking confirmed with an unpaid MANUAL payment in exact cents',
        winner.status === BookingStatus.CONFIRMED &&
          payment.provider === PaymentProvider.MANUAL &&
          payment.status === PaymentStatus.PENDING &&
          payment.amountCents === expectedCents &&
          payment.platformCommissionCents + payment.operatorPayoutCents === payment.amountCents &&
          payment.transactionId === null,
        `amountCents=${payment.amountCents} expected=${expectedCents} rate=${payment.commissionRate}`,
      );
      check(
        'AC-7 create response hides commission from a guest',
        !('platformCommissionCents' in (winner.payment ?? {})),
      );

      // AC-5: double cancel returns seats once and cancels the unpaid payment.
      const cancels = await Promise.allSettled([
        BookingService.cancelBooking(winner.id, { userId: null, email: 'verify-race@example.com' }),
        BookingService.cancelBooking(winner.id, { userId: null, email: 'verify-race@example.com' }),
      ]);
      const seatsAfterCancel = (
        await prisma.schedule.findUniqueOrThrow({ where: { id: schedule.id } })
      ).availableSeats;
      const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { bookingId: winner.id } });
      check(
        'AC-5 concurrent cancels return seats exactly once, payment CANCELED',
        cancels.filter(c => c.status === 'fulfilled').length === 1 &&
          seatsAfterCancel === 2 &&
          paymentAfter.status === PaymentStatus.CANCELED,
        `fulfilled=${cancels.filter(c => c.status === 'fulfilled').length} seats=${seatsAfterCancel} payment=${paymentAfter.status}`,
      );
    }

    // AC-11: database CHECK on seats and primary key on webhook events.
    const negativeSeats = await prisma.schedule
      .update({ where: { id: schedule.id }, data: { availableSeats: -1 } })
      .then(() => false)
      .catch(() => true);
    check('AC-11 database rejects negative availableSeats', negativeSeats);

    const eventId = `evt_verify_${Date.now()}`;
    await prisma.stripeWebhookEvent.create({ data: { id: eventId, type: 'verify.test' } });
    const duplicateRejected = await prisma.stripeWebhookEvent
      .create({ data: { id: eventId, type: 'verify.test' } })
      .then(() => false)
      .catch(() => true);
    await prisma.stripeWebhookEvent.delete({ where: { id: eventId } });
    check('AC-11 duplicate Stripe event id is rejected', duplicateRejected);
  } finally {
    if (createdBookingIds.length) {
      await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    }
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { availableSeats: originalSeats },
    });
    await prisma.$disconnect();
  }

  for (const [name, ok, detail] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  }
  if (results.some(([, ok]) => !ok)) process.exit(1);
}

main().catch(error => {
  console.error(String(error?.message ?? error).replace(/postgres(ql)?:\/\/\S+/g, '***'));
  process.exit(1);
});
