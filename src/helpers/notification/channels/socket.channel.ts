/**
 * Socket Channel - Socket.IO Real-time Notifications
 *
 * Emits real-time events to connected users via Socket.IO.
 */

import { INotificationRecipient } from '../notification.types';

type SocketContent = {
  event: string;
  data: Record<string, any>;
}

type SocketResult = {
  sent: number;
  failed: string[];
}

/**
 * Send real-time notifications via Socket.IO
 */
export const sendSocket = async (
  users: INotificationRecipient[],
  content: SocketContent
): Promise<SocketResult> => {
  const result: SocketResult = { sent: 0, failed: [] };

  const io = global.io;


  if (!io) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('Socket.IO not initialized, skipping socket notifications');
    }
    return { sent: 0, failed: users.map(u => u._id.toString()) };
  }

  const timestamp = new Date().toISOString();

  for (const user of users) {
    try {
      const userId = user._id.toString();

      // Emit to user's private room (user::{userId})
      io.to(`user::${userId}`).emit(content.event, {
        ...content.data,
        timestamp,
      });

      // Legacy format compatibility: get-notification::{userId}
      io.emit(`get-notification::${userId}`, {
        ...content.data,
        timestamp,
      });

      result.sent++;
    } catch (error) {
      console.error(`Socket emit error for user ${user._id}:`, error);
      result.failed.push(user._id.toString());
    }
  }

  return result;
};

export default sendSocket;
