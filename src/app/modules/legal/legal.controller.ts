import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { LegalService } from './legal.service';
import { USER_ROLES } from '../../../enums/user';

const createLegalPage = catchAsync(async (req: Request, res: Response) => {
  const result = await LegalService.createLegalPage(req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: 'Legal document created successfully',
    data: result,
  });
});

const getAll = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as { role?: string } | undefined;
  const isAdmin = user?.role === USER_ROLES.ADMIN;
  const result = await LegalService.getAll(isAdmin);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Legal documents retrieved successfully',
    data: result,
  });
});

const getByIdOrSlug = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as { role?: string } | undefined;
  const isAdmin = user?.role === USER_ROLES.ADMIN;
  const identifier = req.params.identifier || req.params.legalId || req.params.id;
  const result = await LegalService.getByIdOrSlug(identifier, isAdmin);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Legal document retrieved successfully',
    data: result,
  });
});

const updateById = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id || req.params.legalId;
  const result = await LegalService.updateById(id, req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Legal document updated successfully',
    data: result,
  });
});

const deleteById = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id || req.params.legalId;
  await LegalService.deleteById(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Legal document deleted successfully',
    data: null,
  });
});

export const LegalController = {
  createLegalPage,
  getAll,
  getByIdOrSlug,
  updateById,
  deleteById,
};
