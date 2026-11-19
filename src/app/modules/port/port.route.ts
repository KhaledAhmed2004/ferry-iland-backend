import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { PortController } from './port.controller';
import { PortValidation } from './port.validation';

const router = express.Router();

router.post(
  '/',
  auth(USER_ROLES.ADMIN),
  validateRequest(PortValidation.createPortZodSchema),
  PortController.createPort,
);

router.get(
  '/',
  validateRequest(PortValidation.listPortsQueryZodSchema),
  PortController.listPorts,
);

router.get('/:portId', PortController.getPortById);

router.patch(
  '/:portId',
  auth(USER_ROLES.ADMIN),
  validateRequest(PortValidation.updatePortZodSchema),
  PortController.updatePort,
);

router.delete(
  '/:portId',
  auth(USER_ROLES.ADMIN),
  PortController.deletePort,
);

export const PortRoutes = router;
