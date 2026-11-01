import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { RouteController } from './route.controller';
import { RouteValidation } from './route.validation';

const router = express.Router();

// Get list of connected ports (for public route mapping)
router.get('/connected-ports', RouteController.getConnectedPorts);
router.get('/ports', RouteController.getConnectedPorts);

// Get popular journeys / routes (public storefront)
router.get(
  '/popular',
  validateRequest(RouteValidation.popularRoutesQueryZodSchema),
  RouteController.getPopularRoutes,
);

// Create a new ferry route
router.post(
  '/',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(RouteValidation.createRouteZodSchema),
  RouteController.createRoute,
);

// Get list of all routes (with filtering & pagination)
router.get(
  '/',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(RouteValidation.listRoutesQueryZodSchema),
  RouteController.listRoutes,
);

// Bulk update route status (ACTIVE / INACTIVE)
router.patch(
  '/bulk-status',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(RouteValidation.bulkUpdateRouteStatusZodSchema),
  RouteController.bulkUpdateRouteStatus,
);

// Bulk delete routes
router.post(
  '/bulk-delete',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(RouteValidation.bulkDeleteRoutesZodSchema),
  RouteController.bulkDeleteRoutes,
);

// Get single route details by ID
router.get(
  '/:id',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  RouteController.getRouteById,
);

// Update route details by ID
router.patch(
  '/:id',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(RouteValidation.updateRouteZodSchema),
  RouteController.updateRoute,
);

// Delete route by ID
router.delete(
  '/:id',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  RouteController.deleteRoute,
);

export const FerryRouteRoutes = router;
