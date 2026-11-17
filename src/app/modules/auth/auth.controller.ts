import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import config from '../../../config';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { AuthService } from './auth.service';
import { IAuthUser } from './auth.interface';
import {
  IRegisterUserReq,
  ILoginReq,
  IResetPasswordReq,
  IVerifyOtpReq,
} from './auth.validation';

const authCookieOptions = {
  httpOnly: true,
  secure: config.node_env === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

const setAuthCookies = (res: Response, refreshToken: string, sessionId: string) => {
  const options = { ...authCookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 };
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
    data: result.data || null,
  });
});

const loginUser = catchAsync(async (req: Request, res: Response) => {
  const loginData = req.body as ILoginReq;
  const clientIp = req.ip || req.socket.remoteAddress;
  const userAgent = (req.headers['user-agent'] as string) || 'Unknown Device';

  const result = await AuthService.loginUser(loginData, clientIp, userAgent);

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
  const clientIp = req.ip || req.socket.remoteAddress;
  const userAgent = (req.headers['user-agent'] as string) || 'Unknown Device';

  const result = await AuthService.refreshToken(
    bodySessionId || token,
    token,
    clientIp,
    userAgent,
  );

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

export const AuthController = {
  registerUser,
  verifyEmail,
  resendVerification,
  loginUser,
  refreshToken,
  logoutUser,
  forgotPassword,
  resetPassword,
};
