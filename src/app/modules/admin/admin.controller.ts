import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { AdminService } from './admin.service';
import { UpdateCommissionDTO, UpdatePlatformDTO } from './admin.validation';

const getPlatformSettings = catchAsync(async (_req: Request, res: Response) => {
  const result = await AdminService.getPlatformSettings();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Platform settings retrieved successfully',
    data: result,
  });
});

const updateCommissionSettings = catchAsync(
  async (req: Request, res: Response) => {
    const payload: UpdateCommissionDTO = req.body;
    const result = await AdminService.updateCommissionSettings(payload);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: 'Platform commission settings updated successfully',
      data: result,
    });
  },
);

const updatePlatformInfo = catchAsync(async (req: Request, res: Response) => {
  const payload: UpdatePlatformDTO = req.body;
  const result = await AdminService.updatePlatformInfo(payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Platform info updated successfully',
    data: result,
  });
});

const getAdminPayments = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.getAdminPayments(req.query as any);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Admin payments retrieved successfully',
    data: result,
  });
});

export const AdminController = {
  getPlatformSettings,
  updateCommissionSettings,
  updatePlatformInfo,
  getAdminPayments,
};
