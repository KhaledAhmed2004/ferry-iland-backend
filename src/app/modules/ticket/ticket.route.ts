import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { TicketController } from './ticket.controller';
import { TicketValidation } from './ticket.validation';

const router = express.Router();

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

router.get('/pass/:identifier', TicketController.getDigitalPass);
router.get('/:identifier', TicketController.getDigitalPass);

export const TicketRoutes = router;
