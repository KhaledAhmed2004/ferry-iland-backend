import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { LegalController } from './legal.controller';
import { LegalValidation } from './legal.validation';

const router = express.Router();

router.get('/', LegalController.getAll);

router.get(
  '/:legalId',
  validateRequest(LegalValidation.getLegalPage),
  LegalController.getById,
);

router.post(
  '/',
  auth(USER_ROLES.ADMIN),
  validateRequest(LegalValidation.createLegalPage),
  LegalController.createLegalPage,
);

router.patch(
  '/:legalId',
  auth(USER_ROLES.ADMIN),
  validateRequest(LegalValidation.updateLegalPage),
  LegalController.updateById,
);

router.delete(
  '/:legalId',
  auth(USER_ROLES.ADMIN),
  validateRequest(LegalValidation.deleteLegalPage),
  LegalController.deleteById,
);

export const LegalRoutes = router;


