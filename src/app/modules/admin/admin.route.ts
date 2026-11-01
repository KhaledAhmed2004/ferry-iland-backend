import { UserController } from '../user/user.controller';
import { UserValidation } from '../user/user.validation';
import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { BookingController } from '../booking/booking.controller';
import { BookingValidation } from '../booking/booking.validation';
import { DashboardController } from '../dashboard/dashboard.controller';
import { ProviderRoutes } from '../provider/provider.route';
import { AdminController } from './admin.controller';
import { AdminValidation } from './admin.validation';

const router = express.Router();

router.get(
  '/analytics/overview',
  auth(USER_ROLES.ADMIN),
  DashboardController.getAdminAnalyticsOverview,
);

router.get(
  '/bookings',
  auth(USER_ROLES.ADMIN),
  validateRequest(BookingValidation.listBookingsQueryZodSchema),
  BookingController.listAdminBookings,
);

router.get(
  '/bookings/:reference',
  auth(USER_ROLES.ADMIN),
  BookingController.getBookingByReference,
);

router.get(
  '/payments',
  auth(USER_ROLES.ADMIN),
  validateRequest(AdminValidation.listPaymentsQueryZodSchema),
  AdminController.getAdminPayments,
);

router.get(
  '/settings',
  auth(USER_ROLES.ADMIN),
  AdminController.getPlatformSettings,
);

router.patch(
  '/settings/commission',
  auth(USER_ROLES.ADMIN),
  validateRequest(AdminValidation.updateCommissionZodSchema),
  AdminController.updateCommissionSettings,
);

router.patch(
  '/settings/platform',
  auth(USER_ROLES.ADMIN),
  validateRequest(AdminValidation.updatePlatformZodSchema),
  AdminController.updatePlatformInfo,
);

router.patch(
  '/users/:userId',
  auth(USER_ROLES.ADMIN),
  validateRequest(UserValidation.updateProfileZodSchema),
  UserController.updateUserById,
);

router.use('/providers', ProviderRoutes);

export const AdminRoutes = router;
