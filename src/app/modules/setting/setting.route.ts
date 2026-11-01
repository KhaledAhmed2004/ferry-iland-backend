import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { SettingController } from './setting.controller';
import { SettingValidation } from './setting.validation';

const router = express.Router();

router.get(
  '/reward-split',
  auth(USER_ROLES.ADMIN),
  SettingController.getGlobalRewardSplit,
);

router.put(
  '/reward-split',
  auth(USER_ROLES.ADMIN),
  validateRequest(SettingValidation.rewardSplitPayloadSchema),
  SettingController.updateGlobalRewardSplit,
);

export const SettingRoutes = router;
