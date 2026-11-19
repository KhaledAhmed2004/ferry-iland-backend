import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { UserController } from './user.controller';
import { UserValidation } from './user.validation';
import { fileHandler } from '../../middlewares/fileHandler';
import { rateLimitMiddleware } from '../../middlewares/rateLimit';
import express from 'express';

const router = express.Router();

// Roles permitted to access self-service account routes
const ALL_ROLES = [USER_ROLES.USER, USER_ROLES.OPERATOR, USER_ROLES.ADMIN];

/**
 * @route   GET /api/v1/users/me
 * @desc    Get currently authenticated user's profile
 * @access  Private (USER, OPERATOR, ADMIN)
 */
router.get('/me', auth(...ALL_ROLES), UserController.getProfile);

/**
 * @route   PATCH /api/v1/users/me
 * @desc    Update current user's profile information and profile picture
 * @access  Private (USER, OPERATOR, ADMIN)
 * @middleware fileHandler (profilePicture upload), validateRequest (Zod validation)
 */
router.patch(
  '/me',
  auth(...ALL_ROLES),
  fileHandler([{ name: 'profilePicture', maxCount: 1 }]),
  validateRequest(UserValidation.updateProfileZodSchema),
  UserController.updateMyProfile,
);

/**
 * @route   PATCH /api/v1/users/me/password
 * @desc    Change password for the authenticated user
 * @access  Private (USER, OPERATOR, ADMIN)
 * @middleware validateRequest (old and new password validation)
 */
router.patch(
  '/me/password',
  auth(...ALL_ROLES),
  validateRequest(UserValidation.updatePasswordZodSchema),
  UserController.updatePassword,
);

/**
 * @route   GET /api/v1/users/stats
 * @desc    Get platform-wide user analytics and statistics
 * @access  Private (ADMIN only)
 * @note    Defined before /:userId so that 'stats' is not evaluated as a dynamic userId param
 */
router.get('/stats', auth(USER_ROLES.ADMIN), UserController.getUserStats);

/**
 * @route   GET /api/v1/users
 * @desc    Get paginated, searchable, and filterable list of all registered users
 * @access  Private (ADMIN only)
 */
router.get('/', auth(USER_ROLES.ADMIN), UserController.getAllUsers);

/**
 * @route   GET /api/v1/users/:userId
 * @desc    Get profile information for a specific user by ID
 * @access  Private (USER, OPERATOR, ADMIN)
 * @middleware rateLimitMiddleware (60 requests per minute limit)
 */
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

/**
 * @route   PATCH /api/v1/users/:userId/status
 * @desc    Update account status of a specific user (e.g., ACTIVE, SUSPENDED, BANNED)
 * @access  Private (ADMIN only)
 * @middleware validateRequest (status schema validation)
 */
router.patch(
  '/:userId/status',
  auth(USER_ROLES.ADMIN),
  validateRequest(UserValidation.updateStatusZodSchema),
  UserController.updateUserStatus,
);

export const UserRoutes = router;
