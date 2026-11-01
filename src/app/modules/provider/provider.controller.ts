import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { ProviderService } from './provider.service';

const listProviders = catchAsync(async (req: Request, res: Response) => {
  const result = await ProviderService.listProviders(req.query as any);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Providers retrieved successfully',
    pagination: {
      page: result.meta.page,
      limit: result.meta.limit,
      totalPage: result.meta.totalPages,
      total: result.meta.total,
    },
    data: result.data,
  });
});

const getProviderById = catchAsync(async (req: Request, res: Response) => {
  const result = await ProviderService.getProviderById(req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Provider retrieved successfully',
    data: result,
  });
});

const updateProviderStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await ProviderService.updateProviderStatus(
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Provider account status updated successfully',
    data: result,
  });
});

const getOperatorSettings = catchAsync(async (req: Request, res: Response) => {
  const result = await ProviderService.getOperatorSettings(req.user.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Operator settings retrieved successfully',
    data: result,
  });
});

const updateOperatorSettings = catchAsync(
  async (req: Request, res: Response) => {
    const result = await ProviderService.updateOperatorSettings(
      req.user.id,
      req.body,
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: 'Operator settings updated successfully',
      data: result,
    });
  },
);

export const ProviderController = {
  listProviders,
  getProviderById,
  updateProviderStatus,
  getOperatorSettings,
  updateOperatorSettings,
};
