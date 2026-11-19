import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { UserController } from './user.controller';
import { UserValidation } from './user.validation';
import { fileHandler } from '../../middlewares/fileHandler';
import { rateLimit } from '../../middlewares/rateLimit';
import express from 'express';

const router = express.Router();

// Roles permitted to access self-service account routes
const ALL_ROLES = [USER_ROLES.USER, USER_ROLES.OPERATOR, USER_ROLES.ADMIN];

// Public profile lookups: 60 requests per minute per client IP.
// Absorbs directory-style scraping of /users/:userId while normal browsing
// (profile cards, manifest links) stays well under the ceiling.
const publicUserDetailsLimiter = rateLimit({
  routeName: 'public-user-details',
  window: '1m',
  ip: 60,
});

// Get currently authenticated user's profile
router.get('/me', auth(...ALL_ROLES), UserController.getProfile);

// Update current user's profile information and profile picture
router.patch(
  '/me',
  auth(...ALL_ROLES),
  fileHandler([{ name: 'profilePicture', maxCount: 1 }]),
  validateRequest(UserValidation.updateProfileZodSchema),
  UserController.updateMyProfile,
);

// Change password for the authenticated user
router.patch(
  '/me/password',
  auth(...ALL_ROLES),
  validateRequest(UserValidation.updatePasswordZodSchema),
  UserController.updatePassword,
);

// Get platform-wide user analytics and statistics
router.get('/stats', auth(USER_ROLES.ADMIN), UserController.getUserStats);

// Get paginated, searchable, and filterable list of all registered users
router.get('/', auth(USER_ROLES.ADMIN), UserController.getAllUsers);

// Get profile information for a specific user by ID
router.get(
  '/:userId',
  auth(...ALL_ROLES),
  publicUserDetailsLimiter,
  UserController.getUserById,
);

// Update account status of a specific user
router.patch(
  '/:userId/status',
  auth(USER_ROLES.ADMIN),
  validateRequest(UserValidation.updateStatusZodSchema),
  UserController.updateUserStatus,
);

export const UserRoutes = router;
