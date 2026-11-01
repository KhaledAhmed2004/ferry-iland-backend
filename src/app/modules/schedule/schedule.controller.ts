import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { ScheduleService } from './schedule.service';
import { IAuthUser } from '../auth/auth.interface';

const createSchedule = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await ScheduleService.createSchedule(user.id, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Departure schedule slot created successfully',
    data: result,
  });
});

const listSchedules = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await ScheduleService.listOperatorSchedules(
    user.id,
    req.query as any,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Schedules retrieved successfully',
    data: result,
  });
});

const getScheduleById = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await ScheduleService.getScheduleById(user.id, req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Schedule details retrieved successfully',
    data: result,
  });
});

const updateSchedule = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await ScheduleService.updateSchedule(
    user.id,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Schedule slot updated successfully',
    data: result,
  });
});

const updateScheduleStatus = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await ScheduleService.updateScheduleStatus(
    user.id,
    req.params.id,
    req.body.status,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Schedule live status updated successfully',
    data: result,
  });
});

const deleteSchedule = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await ScheduleService.deleteSchedule(user.id, req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

const searchTrips = catchAsync(async (req: Request, res: Response) => {
  const result = await ScheduleService.searchTrips(req.query as any);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message ?? 'Ferry trips found successfully',
    data: result,
  });
});

const getPublicTripById = catchAsync(async (req: Request, res: Response) => {
  const result = await ScheduleService.getPublicTripById(req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Trip details retrieved successfully',
    data: result,
  });
});

const bulkUpdateScheduleStatus = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const { ids, status } = req.body;
  const result = await ScheduleService.bulkUpdateScheduleStatus(user.id, ids, status);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

const bulkDeleteSchedules = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const { ids } = req.body;
  const result = await ScheduleService.bulkDeleteSchedules(user.id, ids);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

export const ScheduleController = {
  createSchedule,
  listSchedules,
  getScheduleById,
  updateSchedule,
  updateScheduleStatus,
  bulkUpdateScheduleStatus,
  deleteSchedule,
  bulkDeleteSchedules,
  searchTrips,
  getPublicTripById,
};
