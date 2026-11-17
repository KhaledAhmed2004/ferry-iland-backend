import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { RouteController } from './route.controller';
import { RouteValidation } from './route.validation';

const router = express.Router();

router.get('/connected-ports', RouteController.getConnectedPorts);

router.get(
  '/popular',
  validateRequest(RouteValidation.popularRoutesQueryZodSchema),
  RouteController.getPopularRoutes,
);

router.post(
  '/',
  auth(USER_ROLES.ADMIN),
  validateRequest(RouteValidation.createRouteZodSchema),
  RouteController.createRoute,
);

router.get(
  '/',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(RouteValidation.listRoutesQueryZodSchema),
  RouteController.listRoutes,
);

router.patch(
  '/bulk-status',
  auth(USER_ROLES.ADMIN),
  validateRequest(RouteValidation.bulkUpdateRouteStatusZodSchema),
  RouteController.bulkUpdateRouteStatus,
);

router.post(
  '/bulk-delete',
  auth(USER_ROLES.ADMIN),
  validateRequest(RouteValidation.bulkDeleteRoutesZodSchema),
  RouteController.bulkDeleteRoutes,
);

router.patch(
  '/:routeId',
  auth(USER_ROLES.ADMIN),
  validateRequest(RouteValidation.updateRouteZodSchema),
  RouteController.updateRoute,
);

router.delete('/:routeId', auth(USER_ROLES.ADMIN), RouteController.deleteRoute);

export const FerryRouteRoutes = router;
