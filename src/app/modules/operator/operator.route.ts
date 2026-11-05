import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { fileHandler } from '../../middlewares/fileHandler';
import { BookingController } from '../booking/booking.controller';
import { BookingValidation } from '../booking/booking.validation';
import { DashboardController } from '../dashboard/dashboard.controller';
import { FerryRoutes } from '../ferry/ferry.route';
import { OffDayRoutes } from '../offDay/offDay.route';
import { ProviderController } from '../provider/provider.controller';
import { ProviderValidation } from '../provider/provider.validation';
import { ScheduleRoutes } from '../schedule/schedule.route';
import { TicketController } from '../ticket/ticket.controller';
import { TicketValidation } from '../ticket/ticket.validation';

const router = express.Router();

router.get(
  '/overview',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  DashboardController.getOperatorOverview,
);

router.get(
  '/settings',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  ProviderController.getOperatorSettings,
);

router.patch(
  '/settings',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  // Optional company logo (multipart field `logo`); its URL lands in req.body.logo.
  fileHandler({
    enforceAllowedFields: ['logo'],
    perFieldMaxCount: { logo: 1 },
    maxFileSizeMB: 2,
  }),
  validateRequest(ProviderValidation.updateOperatorSettingsZodSchema),
  ProviderController.updateOperatorSettings,
);

router.get(
  '/manifest',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(TicketValidation.manifestQueryZodSchema),
  TicketController.getTripManifest,
);

router.patch(
  '/manifest/:ticketId/board',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(TicketValidation.boardPassengerZodSchema),
  TicketController.boardPassenger,
);

router.patch(
  '/manifest/:ticketId/unboard',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  TicketController.unboardPassenger,
);

router.get(
  '/bookings',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(BookingValidation.listBookingsQueryZodSchema),
  BookingController.listOperatorBookings,
);

router.patch(
  '/bookings/:id/check-in',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  BookingController.checkInBooking,
);

router.use('/ferries', FerryRoutes);
router.use('/schedules', ScheduleRoutes);
router.use('/off-days', OffDayRoutes);

export const OperatorRoutes = router;
