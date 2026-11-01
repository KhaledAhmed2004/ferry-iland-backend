import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { SupportController } from './support.controller';
import { SupportValidation } from './support.validation';

const router = express.Router();

// Create support ticket (any authenticated user, restricted users allowed)
router.post(
  '/',
  auth(
    USER_ROLES.ADMIN,
    USER_ROLES.OPERATOR,
    USER_ROLES.USER,
    { allowRestricted: true },
  ),
  validateRequest(SupportValidation.createSupportZodSchema),
  SupportController.createSupport,
);

// Get my tickets (restricted users allowed)
router.get(
  '/my-tickets',
  auth(
    USER_ROLES.ADMIN,
    USER_ROLES.OPERATOR,
    USER_ROLES.USER,
    { allowRestricted: true },
  ),
  SupportController.getMyTickets,
);

// Send message in ticket (restricted users allowed)
router.post(
  '/:id/messages',
  auth(
    USER_ROLES.ADMIN,
    USER_ROLES.OPERATOR,
    USER_ROLES.USER,
    { allowRestricted: true },
  ),
  validateRequest(SupportValidation.addMessageZodSchema),
  SupportController.addMessage,
);

// Get single ticket (restricted users allowed)
router.get(
  '/:id',
  auth(
    USER_ROLES.ADMIN,
    USER_ROLES.OPERATOR,
    USER_ROLES.USER,
    { allowRestricted: true },
  ),
  SupportController.getSupportById,
);

// Get all tickets
router.get(
  '/',
  auth(USER_ROLES.ADMIN),
  SupportController.getAllSupports,
);

// Delete ticket
router.delete(
  '/:id',
  auth(USER_ROLES.ADMIN),
  SupportController.deleteSupport,
);

export const SupportRoutes = router;
