import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { OffDayController } from './offDay.controller';
import { OffDayValidation } from './offDay.validation';

const router = express.Router();

router.post(
  '/',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(OffDayValidation.createOffDayZodSchema),
  OffDayController.createOffDay,
);

router.get(
  '/',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(OffDayValidation.listOffDaysQueryZodSchema),
  OffDayController.listOffDays,
);

router.get(
  '/:offDayId',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  OffDayController.getOffDayById,
);

router.patch(
  '/:offDayId',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(OffDayValidation.updateOffDayZodSchema),
  OffDayController.updateOffDay,
);

router.delete(
  '/:offDayId',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  OffDayController.deleteOffDay,
);

export const OffDayRoutes = router;
