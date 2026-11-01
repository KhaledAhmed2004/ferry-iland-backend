import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { BookingService } from './booking.service';
import { IAuthUser } from '../auth/auth.interface';

const requesterFrom = (req: Request) => {
  const user = req.user as IAuthUser | undefined;
  const emailFromBody =
    req.body && typeof req.body.email === 'string' ? req.body.email : undefined;
  const emailFromQuery =
    typeof req.query.email === 'string' ? req.query.email : undefined;
  return {
    userId: user?.id ?? null,
    role: user?.role ?? null,
    email: emailFromBody ?? emailFromQuery ?? null,
  };
};

const createBooking = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser | undefined;
  const result = await BookingService.createBooking(user?.id ?? null, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message:
      result.status === 'PENDING'
        ? 'Booking reserved, seats are held until payment completes'
        : 'Booking reservation confirmed successfully',
    data: result,
  });
});

const getMyBookings = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await BookingService.getMyBookings(user.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'My bookings retrieved successfully',
    data: result,
  });
});

const getBookingByReference = catchAsync(async (req: Request, res: Response) => {
  const result = await BookingService.getBookingByReference(
    req.params.reference,
    requesterFrom(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Booking reservation found successfully',
    data: result,
  });
});

const cancelBooking = catchAsync(async (req: Request, res: Response) => {
  const result = await BookingService.cancelBooking(
    req.params.id,
    requesterFrom(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Booking cancelled successfully',
    data: result,
  });
});

const listOperatorBookings = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await BookingService.listOperatorBookings(
    user.id,
    req.query as any,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Operator bookings retrieved successfully',
    data: result,
  });
});

const checkInBooking = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await BookingService.checkInBooking(user.id, req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Passenger booking checked in successfully',
    data: result,
  });
});

const listAdminBookings = catchAsync(async (req: Request, res: Response) => {
  const result = await BookingService.listAdminBookings(req.query as any);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Platform bookings retrieved successfully',
    data: result,
  });
});

export const BookingController = {
  createBooking,
  getMyBookings,
  getBookingByReference,
  cancelBooking,
  listOperatorBookings,
  checkInBooking,
  listAdminBookings,
};
