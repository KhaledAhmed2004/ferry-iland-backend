import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { LegalController } from './legal.controller';
import { LegalValidation } from './legal.validation';

const router = express.Router();

// Public: Get all legal pages (with optional auth so admin sees unpublished ones)
router.get('/', auth({ optional: true }), LegalController.getAll);

// Public: Get single legal page by slug or ID
router.get(
  '/:identifier',
  auth({ optional: true }),
  validateRequest(LegalValidation.getLegalPage),
  LegalController.getByIdOrSlug,
);

// Admin: Create new legal page
router.post(
  '/',
  auth(USER_ROLES.ADMIN),
  validateRequest(LegalValidation.createLegalPage),
  LegalController.createLegalPage,
);

// Admin: Update legal page by ID
router.patch(
  '/:id',
  auth(USER_ROLES.ADMIN),
  validateRequest(LegalValidation.updateLegalPage),
  LegalController.updateById,
);

// Admin: Delete legal page by ID
router.delete(
  '/:id',
  auth(USER_ROLES.ADMIN),
  validateRequest(LegalValidation.deleteLegalPage),
  LegalController.deleteById,
);

export const LegalRoutes = router;
