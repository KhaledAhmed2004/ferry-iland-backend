import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth, { AUTH_POLICIES } from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { ChatController } from './chat.controller';
import { ChatValidation } from './chat.validation';

const router = express.Router();

// Read Policy: ADMIN and USER permitted, including suspended accounts (to read existing history & support)
const chatReadAuth = auth(
  USER_ROLES.ADMIN,
  USER_ROLES.OPERATOR,
  USER_ROLES.USER,
  AUTH_POLICIES.ALLOW_RESTRICTED,
);

// Mutation Policy: Active ADMIN, OPERATOR and USER only
const chatMutationAuth = auth(USER_ROLES.ADMIN, USER_ROLES.OPERATOR, USER_ROLES.USER);

router.get(
  '/',
  chatReadAuth,
  validateRequest(ChatValidation.getMyChatsQueryZodSchema),
  ChatController.getMyChats,
);

// Create or get existing chat (Active accounts only)
router.post(
  '/',
  chatMutationAuth,
  validateRequest(ChatValidation.createChatZodSchema),
  ChatController.getOrCreate,
);

router.get(
  '/:chatId',
  chatReadAuth,
  validateRequest(ChatValidation.getChatByIdZodSchema),
  ChatController.getChatById,
);

// Delete chat & cascade purge (Active accounts only)
router.delete(
  '/:chatId',
  chatMutationAuth,
  validateRequest(ChatValidation.deleteChatZodSchema),
  ChatController.deleteChat,
);

export const ChatRoutes = router;
