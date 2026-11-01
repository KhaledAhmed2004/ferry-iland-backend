import express from 'express';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { USER_ROLES } from '../../../enums/user';
import { NotificationController } from './notification.controller';
import { NotificationValidation } from './notification.validation';

const router = express.Router();

router.get(
  '/',
  auth(USER_ROLES.ADMIN, USER_ROLES.OPERATOR, USER_ROLES.USER),
  validateRequest(NotificationValidation.listNotificationsSchema),
  NotificationController.listMyNotifications
);

router.patch(
  '/:notificationId/read',
  auth(USER_ROLES.ADMIN, USER_ROLES.OPERATOR, USER_ROLES.USER),
  validateRequest(NotificationValidation.markReadSchema),
  NotificationController.markRead
);

router.patch(
  '/read-all',
  auth(USER_ROLES.ADMIN, USER_ROLES.OPERATOR, USER_ROLES.USER),
  validateRequest(NotificationValidation.markAllReadSchema),
  NotificationController.markAllRead
);

router.delete(
  '/:notificationId',
  auth(USER_ROLES.ADMIN, USER_ROLES.OPERATOR, USER_ROLES.USER),
  validateRequest(NotificationValidation.paramIdSchema),
  NotificationController.deleteNotification
);

export const NotificationRoutes = router;
