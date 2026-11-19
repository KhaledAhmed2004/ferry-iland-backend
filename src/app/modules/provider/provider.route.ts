import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { ProviderController } from './provider.controller';
import { ProviderValidation } from './provider.validation';

const router = express.Router();

router.get(
  '/',
  auth(USER_ROLES.ADMIN),
  validateRequest(ProviderValidation.listProvidersQueryZodSchema),
  ProviderController.listProviders,
);

router.get(
  '/:providerId',
  auth(USER_ROLES.ADMIN),
  ProviderController.getProviderById,
);

router.patch(
  '/:providerId/status',
  auth(USER_ROLES.ADMIN),
  validateRequest(ProviderValidation.updateProviderStatusZodSchema),
  ProviderController.updateProviderStatus,
);

export const ProviderRoutes = router;
