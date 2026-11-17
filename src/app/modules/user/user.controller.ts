import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { UserService } from './user.service';

const getProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await UserService.getProfile(userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Profile retrieved successfully',
    data: result,
  });
});

const updateUserById = catchAsync(async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const payload = { ...req.body };
  if (req.file) {
    payload.profilePicture = `/images/${req.file.filename}`;
  }
  const result = await UserService.updateProfile(userId, payload);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result.user,
  });
});

const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const payload = { ...req.body };
  if (req.file) {
    payload.profilePicture = `/images/${req.file.filename}`;
  }
  const result = await UserService.updateProfile(userId, payload);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result.user,
  });
});

const updatePassword = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await UserService.updatePassword(userId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result,
  });
});

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.getAllUsers(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Users retrieved successfully',
    pagination: result.pagination,
    data: result.data,
  });
});

const getUserById = catchAsync(async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const result = await UserService.getUserById(userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User retrieved successfully',
    data: result,
  });
});

const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const { status, reason } = req.body;
  const adminId = req.user?.id;
  const result = await UserService.updateUserStatus(
    userId,
    status,
    reason,
    adminId,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User status updated successfully',
    data: result,
  });
});

const getUserStats = catchAsync(async (_req: Request, res: Response) => {
  const result = await UserService.getUserStats();
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User statistics retrieved successfully',
    data: result,
  });
});

export const UserController = {
  getProfile,
  updateMyProfile,
  updateUserById,
  updatePassword,
  getAllUsers,
  getUserById,
  updateUserStatus,
  getUserStats,
};
