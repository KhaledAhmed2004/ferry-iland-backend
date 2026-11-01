import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { UserService } from './user.service';
import { JwtPayload } from 'jsonwebtoken';

// ==========================================
// NestJS User Endpoints (/me & /admin-dashboard)
// ==========================================

const getAdminDashboard = catchAsync(async (_req: Request, res: Response) => {
  const result = await UserService.getAdminDashboard();
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result,
  });
});

const getProfile = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload;
  const userId = user.id || (user as any).userId || (user as any)._id;
  const result = await UserService.getProfile(userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Profile retrieved successfully',
    data: result,
  });
});

const updateUserById = catchAsync(async (req: Request, res: Response) => {
  const userId = req.params.userId || req.params.id;
  const payload = { ...req.body };
  if ((req as any).file) {
    payload.profilePicture = `/images/${(req as any).file.filename}`;
  }
  const result = await UserService.updateProfile(userId, payload);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message || 'User updated successfully',
    data: result.user || result,
  });
});

const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload;
  const userId = user.id || (user as any).userId || (user as any)._id;
  const payload = { ...req.body };
  if ((req as any).file) {
    payload.profilePicture = `/images/${(req as any).file.filename}`;
  }
  const result = await UserService.updateProfile(userId, payload);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message || 'Profile updated successfully',
    data: result.user || result,
  });
});

const updatePassword = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload;
  const userId = user.id || (user as any).userId || (user as any)._id;
  const result = await UserService.updatePassword(userId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result,
  });
});

const getUserSessions = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload;
  const userId = user.id || (user as any).userId || (user as any)._id;
  const result = await UserService.getUserSessions(userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User sessions retrieved successfully',
    data: result,
  });
});

const revokeSession = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload;
  const userId = user.id || (user as any).userId || (user as any)._id;
  const sessionId = req.params.id || req.params.sessionId;
  const result = await UserService.revokeSession(userId, sessionId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result,
  });
});

// ==========================================
// Platform Admin User Management (Tier 3)
// ==========================================

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
  const id = req.params.userId || req.params.id;
  const result = await UserService.getUserById(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User retrieved successfully',
    data: result,
  });
});

const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.userId || req.params.id;
  const { status, reason } = req.body;
  const adminUser = req.user as JwtPayload | undefined;
  const adminId = adminUser?.id || (adminUser as any)?._id;
  const result = await UserService.updateUserStatus(id, status, reason, adminId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User status updated successfully',
    data: result,
  });
});

const suspendUser = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.userId || req.params.id;
  const { reason } = req.body;
  const adminUser = req.user as JwtPayload | undefined;
  const adminId = adminUser?.id || (adminUser as any)?._id;
  const result = await UserService.suspendUser(id, reason, adminId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User suspended successfully',
    data: result,
  });
});

const reactivateUser = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.userId || req.params.id;
  const adminUser = req.user as JwtPayload | undefined;
  const adminId = adminUser?.id || (adminUser as any)?._id;
  const result = await UserService.reactivateUser(id, adminId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User reactivated successfully',
    data: result,
  });
});

const deleteUserByAdmin = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const result = await UserService.deleteUserByAdmin(userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User deleted successfully',
    data: result,
  });
});

const deleteAccount = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload;
  const userId = user.id || (user as any).userId || (user as any)._id;
  const result = await UserService.deleteAccountFromDB(userId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Account deleted successfully',
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
  getAdminDashboard,
  getProfile,
  updateMyProfile,
  updateUserById,
  updatePassword,
  getUserSessions,
  revokeSession,
  getAllUsers,
  getAllUserRoles: getAllUsers,
  getUserById,
  getUserDetailsById: getUserById,
  updateUserStatus,
  suspendUser,
  blockUser: suspendUser,
  reactivateUser,
  unblockUser: reactivateUser,
  approveUser: reactivateUser,
  rejectUser: suspendUser,
  deleteAccount,
  deleteUserByAdmin,
  getUserStats,
  // Backward compatibility
  getUserProfile: getProfile,
  updateProfile: updateMyProfile,
};
