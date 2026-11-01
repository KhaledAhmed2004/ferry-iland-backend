import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { FaqController } from './faq.controller';
import { FaqValidation } from './faq.validation';

const router = express.Router();

// Public passenger help endpoint
router.get(
  '/public',
  FaqController.getPublicFaqs,
);

// Admin management endpoints
router.post(
  '/',
  auth(USER_ROLES.ADMIN),
  validateRequest(FaqValidation.createFaqZodSchema),
  FaqController.createFaq,
);

router.get(
  '/',
  validateRequest(FaqValidation.listFaqsQueryZodSchema),
  FaqController.listFaqs,
);


// Bulk action management endpoints
router.patch(
  '/bulk/publish',
  auth(USER_ROLES.ADMIN),
  validateRequest(FaqValidation.bulkPublishZodSchema),
  FaqController.bulkUpdatePublish,
);

router.patch(
  '/bulk/category',
  auth(USER_ROLES.ADMIN),
  validateRequest(FaqValidation.bulkCategoryZodSchema),
  FaqController.bulkUpdateCategory,
);

router.post(
  '/bulk/delete',
  auth(USER_ROLES.ADMIN),
  validateRequest(FaqValidation.bulkDeleteZodSchema),
  FaqController.bulkDelete,
);

router.get(
  '/:id',
  FaqController.getFaqById,
);

router.patch(
  '/:id',
  auth(USER_ROLES.ADMIN),
  validateRequest(FaqValidation.updateFaqZodSchema),
  FaqController.updateFaq,
);

router.delete(
  '/:id',
  auth(USER_ROLES.ADMIN),
  FaqController.deleteFaq,
);

export const FaqRoutes = router;
