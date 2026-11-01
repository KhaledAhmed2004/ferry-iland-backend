import config from '../../../config';
import { prisma } from '../../../shared/prisma';
import { INotification } from './notification.interface';
import { Notification } from './notification.model';
import { pushNotificationHelper } from './pushNotificationHelper';

export const sendNotifications = async (
  data: INotification,
): Promise<INotification> => {
  const notification = await Notification.create(data);

  // If receiver is a user in postgres
  await prisma.user.findUnique({
    where: { id: data.receiver?.toString() },
    select: { id: true },
  }).catch(() => null);

  await sendPushNotification(undefined, notification);

  emitRealtimeNotification(data.receiver, notification);

  return notification;
};

const sendPushNotification = async (
  deviceTokens: string[] | undefined,
  notification: INotification,
): Promise<void> => {
  if (!deviceTokens?.length) return;

  const message = {
    notification: {
      title: notification.title || config.app.name || 'Notification',
      body: notification.text,
    },
    tokens: deviceTokens,
  };

  try {
    await pushNotificationHelper.sendPushNotifications(message);
  } catch (error) {
    console.error('Failed to send push notification:', error);
  }
};

const emitRealtimeNotification = (
  receiver: INotification['receiver'],
  notification: INotification,
): void => {
  const socketIo = global.io;

  if (!socketIo || !receiver) return;

  socketIo.emit(`get-notification::${receiver.toString()}`, notification);
};
