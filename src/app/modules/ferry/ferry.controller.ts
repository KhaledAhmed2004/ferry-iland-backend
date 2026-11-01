import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { FerryService } from './ferry.service';
import { IAuthUser } from '../auth/auth.interface';

const createFerry = catchAsync(async (req, res) => {
  const user = req.user as IAuthUser;
  const result = await FerryService.createFerry(user.id, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Ferry vessel registered successfully',
    data: result,
  });
});

const listFerries = catchAsync(async (req, res) => {
  const user = req.user as IAuthUser;
  const result = await FerryService.listOperatorFerries(
    user.id,
    req.query as any,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Ferries retrieved successfully',
    data: result,
  });
});

const getFerryById = catchAsync(async (req, res) => {
  const user = req.user as IAuthUser;
  const result = await FerryService.getFerryById(user.id, req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Ferry details retrieved successfully',
    data: result,
  });
});

const getFerryStats = catchAsync(async (req, res) => {
  const user = req.user as IAuthUser;
  const result = await FerryService.getFerryStats(user.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Ferry fleet statistics retrieved successfully',
    data: result,
  });
});

const updateFerry = catchAsync(async (req, res) => {
  const user = req.user as IAuthUser;
  const result = await FerryService.updateFerry(
    user.id,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Ferry vessel updated successfully',
    data: result,
  });
});

const deleteFerry = catchAsync(async (req, res) => {
  const user = req.user as IAuthUser;
  const result = await FerryService.deleteFerry(user.id, req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result.ferry,
  });
});

export const FerryController = {
  createFerry,
  listFerries,
  getFerryById,
  getFerryStats,
  updateFerry,
  deleteFerry,
};
