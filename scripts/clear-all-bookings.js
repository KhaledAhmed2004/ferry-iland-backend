/**
 * Clear All Booking Data from PostgreSQL Database
 * Deletes all records from Ticket, Payment, and Booking tables,
 * and restores Schedule availableSeats to ferry capacity.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearAllBookings() {
  console.log('\n====================================================');
  console.log('🗑️  CLEARING ALL BOOKING DATA FROM DATABASE');
  console.log('====================================================\n');

  try {
    const [initialBookings, initialTickets, initialPayments] = await Promise.all([
      prisma.booking.count(),
      prisma.ticket.count(),
      prisma.payment.count(),
    ]);

    console.log(`📊 Initial counts:`);
    console.log(`   - Bookings: ${initialBookings}`);
    console.log(`   - Tickets:  ${initialTickets}`);
    console.log(`   - Payments: ${initialPayments}\n`);

    console.log('🚀 Deleting Tickets, Payments, and Bookings...');
    const [deletedTickets, deletedPayments, deletedBookings] = await prisma.$transaction([
      prisma.ticket.deleteMany({}),
      prisma.payment.deleteMany({}),
      prisma.booking.deleteMany({}),
    ]);

    console.log(`   ✓ Deleted ${deletedTickets.count} tickets`);
    console.log(`   ✓ Deleted ${deletedPayments.count} payments`);
    console.log(`   ✓ Deleted ${deletedBookings.count} bookings\n`);

    console.log('🔄 Checking & restoring schedule seat capacities...');
    const schedules = await prisma.schedule.findMany({
      include: { ferry: true },
    });

    let resetCount = 0;
    for (const s of schedules) {
      if (s.availableSeats !== s.ferry.capacity) {
        await prisma.schedule.update({
          where: { id: s.id },
          data: { availableSeats: s.ferry.capacity },
        });
        resetCount++;
      }
    }
    console.log(`   ✓ Restored ${resetCount} schedules back to full ferry capacity.\n`);

    const [finalBookings, finalTickets, finalPayments] = await Promise.all([
      prisma.booking.count(),
      prisma.ticket.count(),
      prisma.payment.count(),
    ]);

    console.log(`📊 Final counts:`);
    console.log(`   - Bookings: ${finalBookings}`);
    console.log(`   - Tickets:  ${finalTickets}`);
    console.log(`   - Payments: ${finalPayments}\n`);

    console.log('✅ Successfully cleared all booking data!\n');
  } catch (error) {
    console.error('❌ Failed to clear booking data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

clearAllBookings();
