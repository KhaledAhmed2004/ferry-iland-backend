import { FaqRoutes } from '../app/modules/faq/faq.route';
import express from 'express';
import { AuthRoutes } from '../app/modules/auth/auth.route';
import { UserRoutes } from '../app/modules/user/user.route';
import { NotificationRoutes } from '../app/modules/notification/notification.routes';
import { DashboardRoutes } from '../app/modules/dashboard/dashboard.route';
import { LegalRoutes } from '../app/modules/legal/legal.route';
import { FerryRouteRoutes } from '../app/modules/route/route.route';
import { PortRoutes } from '../app/modules/port/port.route';
import { FerryRoutes } from '../app/modules/ferry/ferry.route';
import { ScheduleRoutes } from '../app/modules/schedule/schedule.route';
import { BookingRoutes } from '../app/modules/booking/booking.route';
import { BookingRequestRoutes } from '../app/modules/bookingRequest/bookingRequest.route';
import { RefundRetryRoutes } from '../app/modules/bookingRequest/refundRetry.route';
import { TicketRoutes } from '../app/modules/ticket/ticket.route';
import { OffDayRoutes } from '../app/modules/offDay/offDay.route';
import { ProviderRoutes } from '../app/modules/provider/provider.route';
import { OperatorRoutes } from '../app/modules/operator/operator.route';
import { AdminRoutes } from '../app/modules/admin/admin.route';
import { PaymentRoutes } from '../app/modules/payment/payment.route';

const router = express.Router();

const apiRoutes = [
  {
    path: '/users',
    route: UserRoutes,
  },
  {
    path: '/user',
    route: UserRoutes,
  },
  {
    path: '/auth',
    route: AuthRoutes,
  },
  {
    path: '/notifications',
    route: NotificationRoutes,
  },
  {
    path: '/dashboard',
    route: DashboardRoutes,
  },
  {
    path: '/legals',
    route: LegalRoutes,
  },
  {
    path: '/legal',
    route: LegalRoutes,
  },
  {
    path: '/routes',
    route: FerryRouteRoutes,
  },
  {
    path: '/ports',
    route: PortRoutes,
  },
  {
    path: '/ferries',
    route: FerryRoutes,
  },
  {
    path: '/schedules',
    route: ScheduleRoutes,
  },
  {
    path: '/trips',
    route: ScheduleRoutes,
  },
  {
    path: '/bookings',
    route: BookingRoutes,
  },
  {
    path: '/manage-booking',
    route: BookingRoutes,
  },
  {
    path: '/booking-requests',
    route: BookingRequestRoutes,
  },
  {
    path: '/refunds',
    route: RefundRetryRoutes,
  },
  {
    path: '/tickets',
    route: TicketRoutes,
  },
  {
    path: '/operator',
    route: OperatorRoutes,
  },
  {
    path: '/admin',
    route: AdminRoutes,
  },
  {
    path: '/providers',
    route: ProviderRoutes,
  },
  {
    path: '/off-days',
    route: OffDayRoutes,
  },
  {
    path: '/faqs',
    route: FaqRoutes,
  },
  {
    path: '/payments',
    route: PaymentRoutes,
  },
];

apiRoutes.forEach(route => router.use(route.path, route.route));

export const AppRoutes = router;
export default router;
