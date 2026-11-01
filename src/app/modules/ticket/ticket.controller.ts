import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { TicketService } from './ticket.service';
import { IAuthUser } from '../auth/auth.interface';

const getTripManifest = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const tripId = req.query.tripId as string;
  const search = req.query.search as string | undefined;
  const status = req.query.boardingStatus as any;

  const result = await TicketService.getTripManifest(
    user.id,
    tripId,
    search,
    status,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Coast Guard passenger manifest retrieved successfully',
    data: result,
  });
});

const boardPassenger = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const luggageCount = req.body.luggageCount as number | undefined;

  const result = await TicketService.boardPassenger(
    user.id,
    req.params.ticketId,
    luggageCount,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Passenger confirmed boarded onto vessel ramp',
    data: result,
  });
});

const unboardPassenger = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;

  const result = await TicketService.unboardPassenger(
    user.id,
    req.params.ticketId,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Passenger boarding status reverted successfully',
    data: result,
  });
});

const getDigitalPass = catchAsync(async (req: Request, res: Response) => {
  const result = await TicketService.getDigitalPass(req.params.identifier);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Digital boarding pass retrieved successfully',
    data: result,
  });
});

export const TicketController = {
  getTripManifest,
  boardPassenger,
  unboardPassenger,
  getDigitalPass,
};
