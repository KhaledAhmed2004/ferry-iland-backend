import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { IAuthUser } from '../auth/auth.interface';
import { BookingRequestService } from './bookingRequest.service';
import { IBookingRequestListQuery } from './bookingRequest.interface';

const actorFrom = (req: Request) => {
  const user = req.user as IAuthUser;
  return { userId: user.id, role: user.role };
};

const listRequests = catchAsync(async (req: Request, res: Response) => {
  const result = await BookingRequestService.listRequests(
    actorFrom(req),
    req.query as IBookingRequestListQuery,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Booking requests retrieved successfully',
    data: result,
  });
});

const RESOLVE_MESSAGES = {
  CANCEL: 'Booking cancelled and the request closed',
  RESCHEDULE: 'Booking moved and the request closed',
  REJECT: 'Request rejected',
} as const;

const resolveRequest = catchAsync(async (req: Request, res: Response) => {
  const result = await BookingRequestService.resolveRequest(
    actorFrom(req),
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: RESOLVE_MESSAGES[req.body.action as keyof typeof RESOLVE_MESSAGES],
    data: result,
  });
});

export const BookingRequestController = {
  listRequests,
  resolveRequest,
};
