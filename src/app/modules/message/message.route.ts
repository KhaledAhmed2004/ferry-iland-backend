import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { fileHandler } from '../../middlewares/fileHandler';
import { MessageController } from './message.controller';
import { MessageValidation } from './message.validation';

const router = express.Router();

router.get(
  '/:chatId',
  auth(
    USER_ROLES.ADMIN,
    USER_ROLES.OPERATOR,
    USER_ROLES.USER,
    { allowRestricted: true },
  ),
  validateRequest(MessageValidation.getMessagesZodSchema),
  MessageController.getMessages,
);


router.post(
  '/:chatId',
  auth(
    USER_ROLES.ADMIN,
    USER_ROLES.OPERATOR,
    USER_ROLES.USER,
    { allowRestricted: true },
  ),
  fileHandler([
    { name: 'attachments', maxCount: 10 },
    { name: 'file', maxCount: 10 },
    { name: 'image', maxCount: 10 },
    { name: 'files', maxCount: 10 },
  ]),
  validateRequest(MessageValidation.sendMessageZodSchema),
  MessageController.sendMessage,
);

export const MessageRoutes = router;
