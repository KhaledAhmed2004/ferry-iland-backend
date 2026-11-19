import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { BookingRequestController } from './bookingRequest.controller';
import { BookingRequestValidation } from './bookingRequest.validation';

const router = express.Router();

// Spec 0004: operators (own ferries only) and admins work the change request list.
router.get(
  '/',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(BookingRequestValidation.listBookingRequestsQueryZodSchema),
  BookingRequestController.listRequests,
);

router.patch(
  '/:requestId/resolve',
  auth(USER_ROLES.OPERATOR, USER_ROLES.ADMIN),
  validateRequest(BookingRequestValidation.resolveBookingRequestZodSchema),
  BookingRequestController.resolveRequest,
);

export const BookingRequestRoutes = router;
