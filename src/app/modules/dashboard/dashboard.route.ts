import express from 'express';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { USER_ROLES } from '../../../enums/user';
import { DashboardController } from './dashboard.controller';
import { DashboardValidation } from './dashboard.validation';

const router = express.Router();

router.get(
  '/analytics/overview',
  auth(USER_ROLES.ADMIN),
  DashboardController.getAdminAnalyticsOverview,
);

router.get(
  '/operator/overview',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  DashboardController.getOperatorOverview,
);

router.get(
  '/stats',
  auth(USER_ROLES.ADMIN),
  DashboardController.getDashboardStats,
);

router.get(
  '/monthly-trends',
  auth(USER_ROLES.ADMIN),
  validateRequest(DashboardValidation.monthlyTrendsQuerySchema),
  DashboardController.getMonthlyTrends,
);

router.get(
  '/recent-activities',
  auth(USER_ROLES.ADMIN),
  validateRequest(DashboardValidation.recentActivitiesQuerySchema),
  DashboardController.getRecentActivities,
);

router.get(
  '/top-performers',
  auth(USER_ROLES.ADMIN),
  DashboardController.getTopPerformers,
);

export const DashboardRoutes = router;
