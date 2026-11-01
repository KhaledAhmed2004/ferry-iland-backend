import { Request, Response } from 'express';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { SettingService } from './setting.service';
import httpStatus from 'http-status';

const getGlobalRewardSplit = catchAsync(async (req: Request, res: Response) => {
  const result = await SettingService.getGlobalRewardSplit();

  if (!result) {
    return sendResponse(res, {
      statusCode: httpStatus.NOT_FOUND,
      success: false,
      message: 'Global reward split configuration not found',
      data: null,
    });
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Global reward split retrieved successfully',
    data: result,
  });
});

const updateGlobalRewardSplit = catchAsync(async (req: Request, res: Response) => {
  const result = await SettingService.updateGlobalRewardSplit(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Global reward split updated successfully',
    data: result,
  });
});

export const SettingController = {
  getGlobalRewardSplit,
  updateGlobalRewardSplit,
};
