/**
 * Push Channel - Firebase Cloud Messaging
 *
 * Sends push notifications via Firebase FCM to user devices.
 * Uses the existing pushNotificationHelper internally.
 */

import { pushNotificationHelper } from '../../../app/modules/notification/pushNotificationHelper';
import { INotificationRecipient } from '../notification.types';

type PushContent = {
  title: string;
  body: string;
  icon?: string;
  image?: string;
  data?: Record<string, string>;
}

type PushResult = {
  sent: number;
  failed: string[];
}

/**
 * Send push notifications to users via Firebase FCM
 */
export const sendPush = async (
  users: INotificationRecipient[],
  content: PushContent
): Promise<PushResult> => {
  const result: PushResult = { sent: 0, failed: [] };

  // Collect all valid device tokens
  const tokensWithUsers: { token: string; userId: string }[] = [];

  for (const user of users) {
    if (user.deviceTokens && Array.isArray(user.deviceTokens) && user.deviceTokens.length > 0) {
      for (const token of user.deviceTokens) {
        tokensWithUsers.push({ token, userId: user._id.toString() });
      }
    }
  }

  if (tokensWithUsers.length === 0) {
    return { sent: users.length, failed: [] };
  }

  const tokens = tokensWithUsers.map(t => t.token);

  const message: any = {
    notification: {
      title: content.title,
      body: content.body,
    },
    tokens,
  };

  if (content.icon) {
    message.notification.icon = content.icon;
  }

  if (content.image) {
    message.notification.image = content.image;
  }

  if (content.data) {
    message.data = content.data;
  }

  try {
    await pushNotificationHelper.sendPushNotifications(message);

    const usersWithTokens = new Set(tokensWithUsers.map(t => t.userId));
    result.sent = usersWithTokens.size;

    const usersWithoutTokens = users.filter(
      u => !u.deviceTokens || u.deviceTokens.length === 0
    );
    result.sent += usersWithoutTokens.length;
  } catch (error) {
    console.error('Push notification error:', error);
    const usersWithTokens = new Set(tokensWithUsers.map(t => t.userId));
    result.failed = Array.from(usersWithTokens);

    const usersWithoutTokens = users.filter(
      u => !u.deviceTokens || u.deviceTokens.length === 0
    );
    result.sent = usersWithoutTokens.length;
  }

  return result;
};

export default sendPush;
