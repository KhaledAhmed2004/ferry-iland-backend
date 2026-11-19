import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { authLimiter } from '../../middlewares/rateLimit';
import { AuthController } from './auth.controller';
import { AuthValidation } from './auth.validation';

const router = express.Router();

router.post(
  '/register',
  authLimiter.register,
  validateRequest(AuthValidation.registerUserZodSchema),
  AuthController.registerUser,
);

router.post(
  '/email/verify',
  authLimiter.verifyEmail,
  validateRequest(AuthValidation.verifyOtpSchema),
  AuthController.verifyEmail,
);

router.post(
  '/email/resend-otp',
  authLimiter.resendOtp,
  validateRequest(AuthValidation.resendOtpSchema),
  AuthController.resendVerification,
);

router.post(
  '/login',
  authLimiter.login,
  validateRequest(AuthValidation.loginSchema),
  AuthController.loginUser,
);

router.post(
  '/refresh',
  authLimiter.refreshToken,
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
  authLimiter.forgotPassword,
  validateRequest(AuthValidation.forgetPasswordSchema),
  AuthController.forgotPassword,
);

router.post(
  '/reset-password',
  authLimiter.resetPassword,
  validateRequest(AuthValidation.resetPasswordSchema),
  AuthController.resetPassword,
);

export const AuthRoutes = router;
