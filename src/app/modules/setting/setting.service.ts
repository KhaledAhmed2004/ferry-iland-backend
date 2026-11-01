import { Setting } from './setting.model';

const getGlobalRewardSplit = async () => {
  const setting = await Setting.findOne({ key: 'GLOBAL_REWARD_SPLIT' });
  if (!setting) {
    return null;
  }
  return setting.value;
};

const updateGlobalRewardSplit = async (payload: { promoter: number; customer: number; platform: number }) => {
  const setting = await Setting.findOneAndUpdate(
    { key: 'GLOBAL_REWARD_SPLIT' },
    { value: payload },
    { new: true, upsert: true }
  );
  return setting.value;
};

export const SettingService = {
  getGlobalRewardSplit,
  updateGlobalRewardSplit,
};
