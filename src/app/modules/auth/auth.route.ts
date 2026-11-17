import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { rateLimitMiddleware } from '../../middlewares/rateLimit';
import { AuthController } from './auth.controller';
import { AuthValidation } from './auth.validation';

const router = express.Router();

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

router.post(
  '/email/verify',
  rateLimitMiddleware({ windowMs: 60_000, max: 5, routeName: 'verify-email-ip' }),
  rateLimitMiddleware({
    windowMs: 15 * 60_000,
    max: 5,
    routeName: 'verify-email-account',
    keyResolver: req => req.body?.email?.toLowerCase()?.trim(),
  }),
  validateRequest(AuthValidation.verifyOtpSchema),
  AuthController.verifyEmail,
);

router.post(
  '/verify-email',
  rateLimitMiddleware({ windowMs: 60_000, max: 5, routeName: 'verify-email-ip' }),
  rateLimitMiddleware({
    windowMs: 15 * 60_000,
    max: 5,
    routeName: 'verify-email-account',
    keyResolver: req => req.body?.email?.toLowerCase()?.trim(),
  }),
  validateRequest(AuthValidation.verifyOtpSchema),
  AuthController.verifyEmail,
);

router.post(
  '/email/resend-otp',
  rateLimitMiddleware({
    windowMs: 60_000,
    max: 3,
    routeName: 'resend-verification-ip',
  }),
  rateLimitMiddleware({
    windowMs: 60_000,
    max: 1,
    routeName: 'resend-verification-email',
    keyResolver: req => req.body?.email?.toLowerCase()?.trim(),
  }),
  validateRequest(AuthValidation.resendOtpSchema),
  AuthController.resendVerification,
);

router.post(
  '/verify-email/resend',
  rateLimitMiddleware({
    windowMs: 60_000,
    max: 3,
    routeName: 'resend-verification-ip',
  }),
  rateLimitMiddleware({
    windowMs: 60_000,
    max: 1,
    routeName: 'resend-verification-email',
    keyResolver: req => req.body?.email?.toLowerCase()?.trim(),
  }),
  validateRequest(AuthValidation.resendOtpSchema),
  AuthController.resendVerification,
);

router.post(
  '/login',
  rateLimitMiddleware({ windowMs: 60_000, max: 5, routeName: 'login' }),
  validateRequest(AuthValidation.loginSchema),
  AuthController.loginUser,
);

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

router.post(
  '/logout',
  auth(USER_ROLES.USER, USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  AuthController.logoutUser,
);

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

export const AuthRoutes = router;
