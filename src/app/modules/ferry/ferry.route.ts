import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { FerryController } from './ferry.controller';
import { FerryValidation } from './ferry.validation';

const router = express.Router();

// Register a new ferry vessel
router.post(
  '/',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(FerryValidation.createFerryZodSchema),
  FerryController.createFerry,
);

// Get list of all ferries (with filtering & pagination)
router.get(
  '/',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(FerryValidation.listFerriesQueryZodSchema),
  FerryController.listFerries,
);

// Get ferry fleet summary statistics for dashboard cards
router.get(
  '/stats',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  FerryController.getFerryStats,
);

// Get single ferry details by ID
router.get(
  '/:id',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  FerryController.getFerryById,
);

// Update ferry details by ID
router.patch(
  '/:id',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(FerryValidation.updateFerryZodSchema),
  FerryController.updateFerry,
);

// Delete ferry by ID
router.delete(
  '/:id',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  FerryController.deleteFerry,
);

export const FerryRoutes = router;
