const fetch = globalThis.fetch;
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

/** Booking created by this run; cleared once the flow cancels it. */
let createdBooking = null;

async function runVerification() {
  console.log('====================================================');
  console.log('🚀 STARTING FERRY E2E INTEGRATION VERIFICATION');
  console.log('====================================================\n');

  const baseUrl = process.env.E2E_API_URL || `http://localhost:${process.env.PORT || 5000}/api/v1`;

  // 1. Search Trips
  console.log('▶ TEST 1: Live Trip Search from PostgreSQL DB');
  // Search day is the departure port's local today (Philipsburg, spec 0003), not the UTC day.
  const targetDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lower_Princes' }).format(new Date());
  const searchUrl = `${baseUrl}/trips/search?from=Philipsburg, Sint Maarten&to=Fort Bay Harbor, Saba&departureDate=${targetDate}&adults=2`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();

  if (!searchData.success || !searchData.data?.outboundTrips?.length) {
    throw new Error(`Search failed: ${JSON.stringify(searchData)}`);
  }

  const trip = searchData.data.outboundTrips[0];
  console.log(`  ✓ Found ${searchData.data.outboundTrips.length} available sailings.`);
  console.log(`  ✓ Sample Trip ID: ${trip.tripId}`);
  console.log(`  ✓ Operator: ${trip.operator} | Vessel: ${trip.vessel}`);
  console.log(`  ✓ Dep: ${trip.departureTime} -> Arr: ${trip.arrivalTime} (${trip.duration})`);
  console.log(`  ✓ Available Seats before booking: ${trip.availableSeats}`);
  console.log(`  ✓ Total Price for 2 adults: $${trip.totalPrice}\n`);

  // 2. Fetch Trip Details
  console.log('▶ TEST 2: Public Trip Details Fetch');
  const detailsUrl = `${baseUrl}/trips/${trip.tripId}`;
  const detailsRes = await fetch(detailsUrl);
  const detailsData = await detailsRes.json();

  if (!detailsData.success || !detailsData.data) {
    throw new Error(`Trip details failed: ${JSON.stringify(detailsData)}`);
  }
  console.log(`  ✓ Trip details verified: ${detailsData.data.departurePort} -> ${detailsData.data.destinationPort}`);
  console.log(`  ✓ Operator Company: ${detailsData.data.operator} | Vessel Type: ${detailsData.data.vesselType}\n`);

  const initialSeats = trip.availableSeats;

  // 3. Create Booking
  console.log('▶ TEST 3: Atomically Create Booking with Tickets & Payment');
  const bookingPayload = {
    scheduleId: trip.tripId,
    leadPassengerName: 'Aishath Niuma',
    leadPassengerEmail: 'niuma.mv@islandhop.mv',
    leadPassengerPhone: '+960 7981234',
    adultsCount: 2,
    childrenCount: 0,
    passengers: [
      {
        passengerName: 'Aishath Niuma',
        nationality: 'Maldivian',
        passportOrId: 'A091823',
        cabinClass: 'STANDARD',
        luggageCount: 1,
      },
      {
        passengerName: 'Ibrahim Rasheed',
        nationality: 'Maldivian',
        passportOrId: 'A091824',
        cabinClass: 'STANDARD',
        luggageCount: 1,
      },
    ],
  };

  const bookingRes = await fetch(`${baseUrl}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bookingPayload),
  });
  const bookingResult = await bookingRes.json();

  if (!bookingResult.success || !bookingResult.data) {
    throw new Error(`Booking creation failed: ${JSON.stringify(bookingResult)}`);
  }

  const booking = bookingResult.data;
  console.log(`  ✓ Booking created successfully! Reference: ${booking.reference}`);
  console.log(`  ✓ Total Amount: $${booking.totalAmount}`);
  console.log(`  ✓ Tickets generated: ${booking.tickets.length}`);
  booking.tickets.forEach((t, i) => {
    console.log(`     [Pax ${i + 1}] ${t.passengerName} (ID: ${t.passportOrId}) -> Ticket: ${t.ticketNumber}`);
  });

  // Remember the booking so a failure below still releases its seats (see cleanup at the end)
  createdBooking = booking;

  // Verify payment
  if (!booking.payment) {
    throw new Error('Payment record was not created with booking!');
  }
  // With PAYMENTS_ENABLED=true a paid booking starts PENDING until Stripe confirms it (spec 0002);
  // with payments off it is CONFIRMED immediately (spec 0001).
  const awaitingPayment = booking.status === 'PENDING';
  const cents = v => (typeof v === 'number' ? `$${(v / 100).toFixed(2)}` : 'n/a');
  console.log(`  ✓ Booking status: ${booking.status}${awaitingPayment ? ' (awaiting payment — PAYMENTS_ENABLED=true)' : ''}`);
  console.log(`  ✓ Payment status: ${booking.payment.status}`);
  console.log(`  ✓ Financials: Total: ${cents(booking.payment.amountCents)} | Commission: ${cents(booking.payment.platformCommissionCents)} | Operator Payout: ${cents(booking.payment.operatorPayoutCents)}\n`);

  // 4. Verify Seat Decrement
  console.log('▶ TEST 4: Verify Available Seats Decremented in Database');
  const verifyTripRes = await fetch(`${baseUrl}/trips/${trip.tripId}`);
  const verifyTripData = await verifyTripRes.json();
  const seatsAfterBooking = verifyTripData.data.availableSeats;
  console.log(`  ✓ Seats before booking: ${initialSeats}`);
  console.log(`  ✓ Seats after booking 2 pax: ${seatsAfterBooking}`);

  if (seatsAfterBooking !== initialSeats - 2) {
    throw new Error(`Seat count mismatch! Expected ${initialSeats - 2}, got ${seatsAfterBooking}`);
  }
  console.log('  ✓ Invariant preserved: availableSeats correctly decremented by 2.\n');

  // 5. Digital Boarding Pass Lookup
  console.log('▶ TEST 5: Digital Boarding Pass Query (by Booking Reference & Ticket Number)');
  if (awaitingPayment) {
    // Unpaid bookings must not expose a boarding pass (spec 0001, AC-6).
    const unpaidPassRes = await fetch(`${baseUrl}/tickets/pass/${booking.reference}`);
    if (unpaidPassRes.status !== 404) {
      throw new Error(`Unpaid booking exposed a boarding pass (HTTP ${unpaidPassRes.status})`);
    }
    console.log('  ✓ No boarding pass before payment (404) — correct for an unpaid booking.');
    console.log('  ℹ️ Pass/QR checks need a paid booking; run with PAYMENTS_ENABLED=false to cover them.\n');
  } else {
  const passByRefRes = await fetch(`${baseUrl}/tickets/pass/${booking.reference}`);
  const passByRefData = await passByRefRes.json();

  if (!passByRefData.success || !passByRefData.data) {
    throw new Error(`Digital pass by ref failed: ${JSON.stringify(passByRefData)}`);
  }
  console.log(`  ✓ Digital Pass found by Ref: ${passByRefData.data.bookingReference}`);
  console.log(`  ✓ Boarding Status: ${passByRefData.data.boardingStatus}`);
  console.log(`  ✓ QR Code Payload: ${passByRefData.data.qrCodePayload.substring(0, 45)}...`);

  const firstTicketNumber = booking.tickets[0].ticketNumber;
  const passByTicketRes = await fetch(`${baseUrl}/tickets/pass/${firstTicketNumber}`);
  const passByTicketData = await passByTicketRes.json();

  if (!passByTicketData.success || !passByTicketData.data) {
    throw new Error(`Digital pass by ticket number failed: ${JSON.stringify(passByTicketData)}`);
  }
  console.log(`  ✓ Digital Pass found by Ticket Number: ${passByTicketData.data.ticketNumber} (${passByTicketData.data.passengerName})\n`);
  }

  // 6. Manage Booking Lookup
  console.log('▶ TEST 6: Self-Service Portal Lookup (/manage-booking/:ref)');
  // A guest proves ownership with the lead passenger email (spec 0001, AC-7)
  const leadEmail = encodeURIComponent(booking.leadPassengerEmail);
  const lookupRes = await fetch(`${baseUrl}/manage-booking/${booking.reference}?email=${leadEmail}`);
  const lookupData = await lookupRes.json();

  if (!lookupData.success || !lookupData.data) {
    throw new Error(`Manage booking lookup failed: ${JSON.stringify(lookupData)}`);
  }
  console.log(`  ✓ Lookup successful: ${lookupData.data.reference}`);
  console.log(`  ✓ Lead: ${lookupData.data.leadPassengerName} (${lookupData.data.leadPassengerEmail})\n`);

  // 7. Booking Cancellation & Seat Restoration
  console.log('▶ TEST 7: Booking Cancellation & Invariant Verification');
  const cancelRes = await fetch(`${baseUrl}/bookings/${booking.id}/cancel`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: booking.leadPassengerEmail }),
  });
  const cancelData = await cancelRes.json();

  if (!cancelData.success) {
    throw new Error(`Cancellation failed: ${JSON.stringify(cancelData)}`);
  }
  createdBooking = null; // released — nothing left to clean up
  console.log(`  ✓ Booking cancelled: status = ${cancelData.data.status}`);

  const checkFinalSeatsRes = await fetch(`${baseUrl}/trips/${trip.tripId}`);
  const checkFinalSeatsData = await checkFinalSeatsRes.json();
  const seatsAfterCancel = checkFinalSeatsData.data.availableSeats;
  console.log(`  ✓ Seats after cancellation: ${seatsAfterCancel} (restored to initial ${initialSeats})`);

  if (seatsAfterCancel !== initialSeats) {
    throw new Error(`Seat count not restored! Expected ${initialSeats}, got ${seatsAfterCancel}`);
  }
  console.log('  ✓ Invariant preserved: availableSeats restored correctly.\n');

  console.log('====================================================');
  console.log('🎉 ALL END-TO-END FLOW TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

/** Cancel a booking this run created if a later step failed, so its seats are not left held. */
async function releaseCreatedBooking() {
  if (!createdBooking) return;
  const baseUrl = process.env.E2E_API_URL || `http://localhost:${process.env.PORT || 5000}/api/v1`;
  try {
    const res = await fetch(`${baseUrl}/bookings/${createdBooking.id}/cancel`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: createdBooking.leadPassengerEmail }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.error(`  ↺ Cleanup: cancelled test booking ${createdBooking.reference}`);
  } catch {
    console.error(`  ⚠️ Cleanup failed: cancel test booking ${createdBooking.reference} manually`);
  }
}

runVerification().catch(async err => {
  console.error('❌ E2E VERIFICATION FAILED:', err);
  await releaseCreatedBooking();
  process.exit(1);
});
