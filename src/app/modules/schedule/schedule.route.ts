import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { ScheduleController } from './schedule.controller';
import { ScheduleValidation } from './schedule.validation';

const router = express.Router();

router.get(
  '/search',
  validateRequest(ScheduleValidation.tripSearchQueryZodSchema),
  ScheduleController.searchTrips,
);

router.get(
  '/public/:id',
  ScheduleController.getPublicTripById,
);

router.get(
  '/details/:id',
  ScheduleController.getPublicTripById,
);

router.post(
  '/',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(ScheduleValidation.createScheduleZodSchema),
  ScheduleController.createSchedule,
);

router.get(
  '/',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(ScheduleValidation.listSchedulesQueryZodSchema),
  ScheduleController.listSchedules,
);

router.patch(
  '/bulk-status',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(ScheduleValidation.bulkUpdateScheduleStatusZodSchema),
  ScheduleController.bulkUpdateScheduleStatus,
);

router.post(
  '/bulk-delete',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(ScheduleValidation.bulkDeleteSchedulesZodSchema),
  ScheduleController.bulkDeleteSchedules,
);

router.get(
  '/:id',
  (req, res, next) => {
    // 1. If accessing customer-facing /trips/:id, serve public trip details (for both guests and logged-in passengers)
    if (req.baseUrl.endsWith('/trips') || req.originalUrl.includes('/trips/')) {
      return ScheduleController.getPublicTripById(req, res, next);
    }

    // 2. If token is provided on /schedules/:id, verify if operator/admin; otherwise fallback to public trip details
    if (req.headers.authorization) {
      return auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN)(req, res, (err) => {
        if (err) {
          return ScheduleController.getPublicTripById(req, res, next);
        }
        return ScheduleController.getScheduleById(req, res, next);
      });
    }

    return ScheduleController.getPublicTripById(req, res, next);
  },
);

router.patch(
  '/:id',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(ScheduleValidation.updateScheduleZodSchema),
  ScheduleController.updateSchedule,
);

router.patch(
  '/:id/status',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(ScheduleValidation.updateScheduleStatusZodSchema),
  ScheduleController.updateScheduleStatus,
);

router.delete(
  '/:id',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  ScheduleController.deleteSchedule,
);

export const ScheduleRoutes = router;
