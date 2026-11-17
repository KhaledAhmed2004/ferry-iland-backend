import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { UserController } from './user.controller';
import { UserValidation } from './user.validation';
import { fileHandler } from '../../middlewares/fileHandler';
import { rateLimitMiddleware } from '../../middlewares/rateLimit';
import express from 'express';

const router = express.Router();

const ALL_ROLES = [USER_ROLES.USER, USER_ROLES.OPERATOR, USER_ROLES.ADMIN];

// Get current authenticated user profile and details
router.get('/me', auth(...ALL_ROLES), UserController.getProfile);

// Update user profile
router.patch(
  '/me',
  auth(...ALL_ROLES),
  fileHandler([{ name: 'profilePicture', maxCount: 1 }]),
  validateRequest(UserValidation.updateProfileZodSchema),
  UserController.updateMyProfile,
);

// Change password for authenticated user and invalidate active sessions
router.patch(
  '/me/password',
  auth(...ALL_ROLES),
  validateRequest(UserValidation.updatePasswordZodSchema),
  UserController.updatePassword,
);

// Get platform-wide user statistics for admin management
router.get('/stats', auth(USER_ROLES.ADMIN), UserController.getUserStats);

// Get paginated list of all users with search and filter queries
router.get('/', auth(USER_ROLES.ADMIN), UserController.getAllUsers);

// Get detailed user profile by user ID
router.get(
  '/:userId',
  auth(...ALL_ROLES),
  rateLimitMiddleware({
    windowMs: 60_000,
    max: 60,
    routeName: 'public-user-details',
  }),
  UserController.getUserById,
);

// Update account status for a specific user
router.patch(
  '/:userId/status',
  auth(USER_ROLES.ADMIN),
  validateRequest(UserValidation.updateStatusZodSchema),
  UserController.updateUserStatus,
);

export const UserRoutes = router;
