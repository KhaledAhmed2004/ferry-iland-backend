import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { FaqController } from './faq.controller';
import { FaqValidation } from './faq.validation';

const router = express.Router();

// Public FAQ endpoint - Only published FAQs, no pagination (for Help Center & Landing page)
router.get('/public', FaqController.getPublicFaqs);

// Admin FAQ management endpoints
router.post(
  '/',
  auth(USER_ROLES.ADMIN),
  validateRequest(FaqValidation.createFaqZodSchema),
  FaqController.createFaq,
);

router.get(
  '/',
  auth(USER_ROLES.ADMIN),
  validateRequest(FaqValidation.listFaqsQueryZodSchema),
  FaqController.listFaqs,
);

router.patch(
  '/:faqId',
  auth(USER_ROLES.ADMIN),
  validateRequest(FaqValidation.updateFaqZodSchema),
  FaqController.updateFaq,
);

router.delete('/:faqId', auth(USER_ROLES.ADMIN), FaqController.deleteFaq);

export const FaqRoutes = router;
