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
  '/admin/:reference',
  auth(USER_ROLES.ADMIN),
  BookingController.getBookingByReference,
);

router.get(
  '/operator',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(BookingValidation.listBookingsQueryZodSchema),
  BookingController.listOperatorBookings,
);

router.get(
  '/:reference',
  optionalAuth,
  BookingController.getBookingByReference,
);

router.patch('/:bookingId/cancel', optionalAuth, BookingController.cancelBooking);

// Spec 0004: inside 24h the customer asks the operator instead of cancelling (AC-5, AC-6).
router.post(
  '/:idOrReference/requests',
  optionalAuth,
  validateRequest(BookingValidation.createBookingRequestZodSchema),
  BookingController.createBookingRequest,
);

router.patch(
  '/:idOrReference/requests/:requestId/withdraw',
  optionalAuth,
  BookingController.withdrawBookingRequest,
);

// Spec 0004: the trips a leg may move to, for staff and the customer's preferred trip (AC-15).
router.get(
  '/:idOrReference/move-options',
  optionalAuth,
  validateRequest(BookingValidation.moveOptionsQueryZodSchema),
  BookingController.getMoveOptions,
);

// Spec 0004: a direct staff move, for example a no show (AC-11 to AC-14, AC-19).
router.post(
  '/:idOrReference/move',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(BookingValidation.moveBookingZodSchema),
  BookingController.moveBooking,
);

router.patch(
  '/operator/:bookingId/check-in',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  BookingController.checkInBooking,
);

export const BookingRoutes = router;
