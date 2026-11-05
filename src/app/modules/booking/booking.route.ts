import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import optionalAuth from '../../middlewares/optionalAuth';
import validateRequest from '../../middlewares/validateRequest';
import { BookingController } from './booking.controller';
import { BookingValidation } from './booking.validation';

const router = express.Router();

// Guests may book; a signed-in caller is identified so the booking is linked to their account.
router.post(
  '/',
  optionalAuth,
  validateRequest(BookingValidation.createBookingZodSchema),
  BookingController.createBooking,
);

router.get(
  '/my',
  auth(USER_ROLES.USER, USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  BookingController.getMyBookings,
);

router.get(
  '/manage/:reference',
  optionalAuth,
  BookingController.getBookingByReference,
);
router.get(
  '/admin',
  auth(USER_ROLES.ADMIN),
  validateRequest(BookingValidation.listBookingsQueryZodSchema),
  BookingController.listAdminBookings,
);

router.get(
  '/operator',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(BookingValidation.listBookingsQueryZodSchema),
  BookingController.listOperatorBookings,
);

router.get('/:reference', optionalAuth, BookingController.getBookingByReference);

router.patch('/:id/cancel', optionalAuth, BookingController.cancelBooking);

router.patch(
  '/operator/:id/check-in',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  BookingController.checkInBooking,
);

export const BookingRoutes = router;
