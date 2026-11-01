import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { UserController } from './user.controller';
import { UserValidation } from './user.validation';
import { fileHandler } from '../../middlewares/fileHandler';
import { rateLimitMiddleware } from '../../middlewares/rateLimit';
import express from 'express';

const router = express.Router();

const ALL_ROLES = [
  USER_ROLES.USER,
  USER_ROLES.OPERATOR,
  USER_ROLES.ADMIN,
];

// Get aggregated admin dashboard metrics and overview
router.get(
  '/admin-dashboard',
  auth(USER_ROLES.ADMIN),
  UserController.getAdminDashboard,
);

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
router.post(
  '/me/password',
  auth(...ALL_ROLES),
  validateRequest(UserValidation.updatePasswordZodSchema),
  UserController.updatePassword,
);

// Get list of active login sessions for current user
router.get('/me/sessions', auth(...ALL_ROLES), UserController.getUserSessions);

// Revoke a specific active session by session ID
router.delete(
  '/me/sessions/:id',
  auth(...ALL_ROLES),
  UserController.revokeSession,
);

// Get user profile (alias for /me)
router.get('/profile', auth(...ALL_ROLES), UserController.getProfile);

// Update user profile (alias for /me)
router.patch(
  '/profile',
  auth(...ALL_ROLES),
  fileHandler([{ name: 'profilePicture', maxCount: 1 }]),
  validateRequest(UserValidation.updateProfileZodSchema),
  UserController.updateMyProfile,
);

// Self-delete or deactivate current authenticated user account
router.delete(
  '/delete-account',
  auth(...ALL_ROLES),
  validateRequest(UserValidation.deleteUserZodSchema),
  UserController.deleteAccount,
);

// Get platform-wide user statistics for admin management
router.get(
  '/stats',
  auth(USER_ROLES.ADMIN),
  UserController.getUserStats,
);

// Get paginated list of all users with search and filter queries
router.get(
  '/',
  auth(USER_ROLES.ADMIN),
  UserController.getAllUsers,
);

// Get detailed user profile by user ID
// Update user profile by ID (admin only)
router.patch(
  '/:userId',
  auth(USER_ROLES.ADMIN),
  validateRequest(UserValidation.updateProfileZodSchema),
  UserController.updateUserById,
);

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

// Update account status for a specific user (admin only)
router.patch(
  '/:userId/status',
  auth(USER_ROLES.ADMIN),
  validateRequest(UserValidation.updateStatusZodSchema),
  UserController.updateUserStatus,
);

// Suspend a user account with reason (admin only)
router.patch(
  '/:userId/suspend',
  auth(USER_ROLES.ADMIN),
  validateRequest(UserValidation.suspendUserZodSchema),
  UserController.suspendUser,
);

// Reactivate a suspended or deactivated user account (admin only)
router.patch(
  '/:userId/reactivate',
  auth(USER_ROLES.ADMIN),
  UserController.reactivateUser,
);

// Block user account access (admin only)
router.patch(
  '/:userId/block',
  auth(USER_ROLES.ADMIN),
  validateRequest(UserValidation.blockUserZodSchema),
  UserController.blockUser,
);

// Unblock user account access (admin only)
router.patch(
  '/:userId/unblock',
  auth(USER_ROLES.ADMIN),
  UserController.unblockUser,
);

// Permanently delete or soft-delete user account (admin only)
router.delete(
  '/:userId',
  auth(USER_ROLES.ADMIN),
  UserController.deleteUserByAdmin,
);

export const UserRoutes = router;
