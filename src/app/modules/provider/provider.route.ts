import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { ProviderController } from './provider.controller';
import { ProviderValidation } from './provider.validation';

const router = express.Router();

router.get(
  '/settings',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  ProviderController.getOperatorSettings,
);

router.patch(
  '/settings',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(ProviderValidation.updateOperatorSettingsZodSchema),
  ProviderController.updateOperatorSettings,
);

router.get(
  '/',
  auth(USER_ROLES.ADMIN),
  ProviderController.listProviders,
);

router.get(
  '/:id',
  auth(USER_ROLES.ADMIN),
  ProviderController.getProviderById,
);

router.patch(
  '/:id/status',
  auth(USER_ROLES.ADMIN),
  validateRequest(ProviderValidation.updateProviderStatusZodSchema),
  ProviderController.updateProviderStatus,
);

export const ProviderRoutes = router;
