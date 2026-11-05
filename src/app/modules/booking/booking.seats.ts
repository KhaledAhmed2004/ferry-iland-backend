import { Prisma } from '@prisma/client';

/**
 * Seats for a booking live on its outbound schedule and, for a round trip or same day return,
 * on its return schedule too. Every place that takes or gives back seats goes through here.
 */

type Db = Prisma.TransactionClient;

export type IBookingSeatsRef = {
  scheduleId: string;
  returnScheduleId?: string | null;
  adultsCount: number;
  childrenCount: number;
};

export const bookingScheduleIds = (booking: IBookingSeatsRef): string[] =>
  booking.returnScheduleId
    ? [booking.scheduleId, booking.returnScheduleId]
    : [booking.scheduleId];

export const bookingSeatCount = (booking: IBookingSeatsRef): number =>
  booking.adultsCount + booking.childrenCount;

/**
 * Takes `seats` on every schedule, or none: a schedule without enough seats undoes the ones
 * already taken and returns false. The conditional update is what prevents overselling.
 */
export const takeSeats = async (
  tx: Db,
  scheduleIds: string[],
  seats: number,
): Promise<boolean> => {
  const taken: string[] = [];
  for (const id of scheduleIds) {
    const result = await tx.schedule.updateMany({
      where: { id, availableSeats: { gte: seats } },
      data: { availableSeats: { decrement: seats } },
    });
    if (result.count !== 1) {
      for (const takenId of taken) {
        await tx.schedule.update({
          where: { id: takenId },
          data: { availableSeats: { increment: seats } },
        });
      }
      return false;
    }
    taken.push(id);
  }
  return true;
};

/** Gives the booking's seats back on every schedule it holds. */
export const releaseBookingSeats = async (
  tx: Db,
  booking: IBookingSeatsRef,
): Promise<void> => {
  const seats = bookingSeatCount(booking);
  for (const id of bookingScheduleIds(booking)) {
    await tx.schedule.update({
      where: { id },
      data: { availableSeats: { increment: seats } },
    });
  }
};
