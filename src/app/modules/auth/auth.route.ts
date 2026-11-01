import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { rateLimitMiddleware } from '../../middlewares/rateLimit';
import { AuthController } from './auth.controller';
import { AuthValidation } from './auth.validation';

const router = express.Router();

// Register a new user or operator account
router.post(
  '/register',
  rateLimitMiddleware({ windowMs: 3600000, max: 5, routeName: 'register-ip' }),
  rateLimitMiddleware({
    windowMs: 3600000,
    max: 3,
    routeName: 'register-phone',
    keyResolver: req => req.body?.phoneNumber || req.body?.phone,
  }),
  rateLimitMiddleware({
    windowMs: 3600000,
    max: 3,
    routeName: 'register-email',
    keyResolver: req => req.body?.email,
  }),
  validateRequest(AuthValidation.registerUserZodSchema),
  AuthController.registerUser,
);

// Verify email address using 6-digit OTP
router.post(
  '/verify-email',
  rateLimitMiddleware({ windowMs: 60_000, max: 5, routeName: 'verify-email' }),
  validateRequest(AuthValidation.verifyOtpSchema),
  AuthController.verifyEmail,
);

// Resend verification OTP to user's email
router.post(
  '/verify-email/resend',
  rateLimitMiddleware({
    windowMs: 60_000,
    max: 3,
    routeName: 'resend-verification',
  }),
  validateRequest(AuthValidation.resendOtpSchema),
  AuthController.resendVerification,
);

// User and operator authentication (login)
router.post(
  '/login',
  rateLimitMiddleware({ windowMs: 60_000, max: 5, routeName: 'login' }),
  validateRequest(AuthValidation.loginSchema),
  AuthController.loginUser,
);

// Refresh access token via rotational session token
router.post(
  '/refresh',
  rateLimitMiddleware({
    windowMs: 60_000,
    max: 30,
    routeName: 'refresh-token',
  }),
  validateRequest(AuthValidation.refreshTokenSchema),
  AuthController.refreshToken,
);

// Logout from current active session
router.post(
  '/logout',
  auth(
    USER_ROLES.USER,
    USER_ROLES.OPERATOR,
    USER_ROLES.ADMIN,
  ),
  AuthController.logoutUser,
);

// Logout and revoke all active sessions across all devices
router.post(
  '/logout-all',
  auth(
    USER_ROLES.USER,
    USER_ROLES.OPERATOR,
    USER_ROLES.ADMIN,
  ),
  AuthController.logoutAll,
);

// Request password reset token via email
router.post(
  '/forgot-password',
  rateLimitMiddleware({
    windowMs: 60_000,
    max: 3,
    routeName: 'forgot-password',
  }),
  validateRequest(AuthValidation.forgetPasswordSchema),
  AuthController.forgotPassword,
);

// Reset password using valid verification token
router.post(
  '/reset-password',
  rateLimitMiddleware({
    windowMs: 60_000,
    max: 5,
    routeName: 'reset-password',
  }),
  validateRequest(AuthValidation.resetPasswordSchema),
  AuthController.resetPassword,
);

// Claim and initialize root admin credentials (first-time onboarding)
router.post(
  '/claim-admin',
  auth(USER_ROLES.ADMIN),
  rateLimitMiddleware({ windowMs: 60_000, max: 5, routeName: 'claim-admin' }),
  validateRequest(AuthValidation.claimAdminZodSchema),
  AuthController.claimAdmin,
);

export const AuthRoutes = router;
