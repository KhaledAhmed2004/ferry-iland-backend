import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { LegalService } from './legal.service';

const createLegalPage = catchAsync(async (req: Request, res: Response) => {
  const result = await LegalService.createLegalPage(req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: 'Legal page created successfully',
    data: result,
  });
});

const getAll = catchAsync(async (req: Request, res: Response) => {
  const result = await LegalService.getAll();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Legal pages retrieved successfully',
    data: result,
  });
});

const getById = catchAsync(async (req: Request, res: Response) => {
  const result = await LegalService.getById(req.params.legalId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Legal page retrieved successfully',
    data: result,
  });
});

const updateById = catchAsync(async (req: Request, res: Response) => {
  const result = await LegalService.updateById(req.params.legalId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Legal page updated successfully',
    data: result,
  });
});

const deleteById = catchAsync(async (req: Request, res: Response) => {
  await LegalService.deleteById(req.params.legalId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Legal page deleted successfully',
  });
});

export const LegalController = {
  createLegalPage,
  getAll,
  getById,
  updateById,
  deleteById,
};

