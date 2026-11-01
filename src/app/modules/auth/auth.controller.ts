import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import config from '../../../config';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { AuthService } from './auth.service';
import { IAuthUser } from './auth.interface';
import {
  IChangePasswordReq,
  IRegisterUserReq,
  ILoginReq,
  IResetPasswordReq,
  IVerifyOtpReq,
  IClaimAdminReq,
} from './auth.validation';

const authCookieOptions = {
  httpOnly: true,
  secure: config.node_env === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

/**
 * The refresh token is random, so a browser also needs the session id to refresh with
 * cookies alone. Both are httpOnly.
 */
const setAuthCookies = (res: Response, refreshToken: string, sessionId: string) => {
  const options = { ...authCookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 }; // 30 days
  res.cookie('refreshToken', refreshToken, options);
  res.cookie('sessionId', sessionId, options);
};

const clearAuthCookies = (res: Response) => {
  res.clearCookie('refreshToken', authCookieOptions);
  res.clearCookie('sessionId', authCookieOptions);
};

const registerUser = catchAsync(async (req: Request, res: Response) => {
  const userData = req.body as IRegisterUserReq;
  const result = await AuthService.registerUser(userData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: result.message,
    data: result,
  });
});

const verifyEmail = catchAsync(async (req: Request, res: Response) => {
  const verifyData = req.body as IVerifyOtpReq;
  const result = await AuthService.verifyEmail(verifyData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result.data,
  });
});

const resendVerification = catchAsync(async (req: Request, res: Response) => {
  const email = req.body.email;
  const result = await AuthService.resendVerificationEmail(email);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: null,
  });
});

const loginUser = catchAsync(async (req: Request, res: Response) => {
  const loginData = req.body as ILoginReq;
  const ip = req.ip || req.socket.remoteAddress;
  const deviceInfo = (req.headers['user-agent'] as string) || 'Unknown Device';

  const result = await AuthService.loginUser(loginData, ip, deviceInfo);

  // Set refresh token + session id in httpOnly cookies
  if (result?.tokens?.refreshToken) {
    setAuthCookies(res, result.tokens.refreshToken, result.sessionId);
  }

  const isMobileClient = req.headers['x-client-type'] === 'mobile';

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User logged in successfully.',
    data: {
      accessToken: result.tokens.accessToken,
      ...(isMobileClient ? { refreshToken: result.tokens.refreshToken } : {}),
      sessionId: result.sessionId,
      user: result.user,
      isApproved: result.isApproved,
    },
  });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const cookieToken = req.cookies?.refreshToken as string | undefined;
  const bodyToken = (req.body as { refreshToken?: string })?.refreshToken;
  const bodySessionId =
    (req.body as { sessionId?: string })?.sessionId ||
    (req.cookies?.sessionId as string | undefined);

  const token = bodyToken || cookieToken || '';
  const ip = req.ip || req.socket.remoteAddress;
  const deviceInfo = (req.headers['user-agent'] as string) || 'Unknown Device';

  const result = await AuthService.refreshToken(
    bodySessionId || token,
    token,
    ip,
    deviceInfo,
  );

  // Rotate refresh token cookie
  if (result?.tokens?.refreshToken) {
    setAuthCookies(res, result.tokens.refreshToken, result.sessionId);
  }

  const isMobileClient = req.headers['x-client-type'] === 'mobile';

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Token refreshed successfully.',
    data: {
      accessToken: result.tokens.accessToken,
      ...(isMobileClient ? { refreshToken: result.tokens.refreshToken } : {}),
      sessionId: result.sessionId,
    },
  });
});

// Logout Single Session
const logoutUser = catchAsync(async (req: Request, res: Response) => {
  const { deviceToken, sessionId } = req.body;
  const user = req.user as IAuthUser;

  await AuthService.logoutUser(user, sessionId, deviceToken);

  clearAuthCookies(res);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User logged out successfully.',
  });
});

// Logout All Sessions
const logoutAll = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;

  await AuthService.logoutAll(user.id);

  clearAuthCookies(res);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Logged out from all devices.',
  });
});

// Get Current User Status
const getMyStatus = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await AuthService.getMyStatus(user.id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Account status retrieved.',
    data: result,
  });
});

// Forgot Password
const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const email = req.body.email;
  const result = await AuthService.forgotPassword(email);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: null,
  });
});

// Reset Password
const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const rawToken = req.headers.authorization || '';
  const resetData = req.body as IResetPasswordReq;
  const result = await AuthService.resetPassword(rawToken, resetData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: null,
  });
});

// Change Password
const changePassword = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const passwordData = req.body as IChangePasswordReq;
  const result = await AuthService.changePassword(user, passwordData);

  clearAuthCookies(res);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
  });
});

// Claim Admin
const claimAdmin = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const claimData = req.body as IClaimAdminReq;
  const result = await AuthService.claimAdmin(user, claimData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Admin account credentials updated successfully.',
    data: result,
  });
});

export const AuthController = {
  registerUser,
  verifyEmail,
  resendVerification,
  loginUser,
  refreshToken,
  logoutUser,
  logoutAll,
  getMyStatus,
  forgotPassword,
  resetPassword,
  changePassword,
  claimAdmin,
};
