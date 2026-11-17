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

// Spec 0006: Payments, Refunds, and Operator payouts tabs (read only, ADMIN only).
router.get(
  '/payments',
  auth(USER_ROLES.ADMIN),
  validateRequest(AdminValidation.listPaymentsQueryZodSchema),
  AdminController.getAdminPayments,
);

router.get(
  '/payments/refunds',
  auth(USER_ROLES.ADMIN),
  validateRequest(AdminValidation.listRefundsQueryZodSchema),
  AdminController.getAdminRefunds,
);

router.get(
  '/payments/payouts',
  auth(USER_ROLES.ADMIN),
  validateRequest(AdminValidation.listPayoutsQueryZodSchema),
  AdminController.getAdminPayouts,
);

router.get(
  '/payments/payouts/:operatorId/bookings',
  auth(USER_ROLES.ADMIN),
  validateRequest(AdminValidation.payoutBookingsZodSchema),
  AdminController.getAdminPayoutBookings,
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

router.use('/providers', ProviderRoutes);

export const AdminRoutes = router;
