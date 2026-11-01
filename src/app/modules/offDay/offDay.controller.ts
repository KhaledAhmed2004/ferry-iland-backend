import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { OffDayService } from './offDay.service';
import { IAuthUser } from '../auth/auth.interface';

const createOffDay = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await OffDayService.createOffDay(user.id, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Off-day blackout scheduled successfully',
    data: result,
  });
});

const listOffDays = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await OffDayService.listOperatorOffDays(
    user.id,
    req.query as any,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Off-days retrieved successfully',
    data: result,
  });
});

const getOffDayById = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await OffDayService.getOffDayById(user.id, req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Off-day details retrieved successfully',
    data: result,
  });
});

const updateOffDay = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await OffDayService.updateOffDay(
    user.id,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Off-day blackout updated successfully',
    data: result,
  });
});

const deleteOffDay = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await OffDayService.deleteOffDay(user.id, req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

export const OffDayController = {
  createOffDay,
  listOffDays,
  getOffDayById,
  updateOffDay,
  deleteOffDay,
};
