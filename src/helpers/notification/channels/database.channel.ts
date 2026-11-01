/**
 * Database Channel - MongoDB Notification Storage
 *
 * Persists notifications to the Notification collection.
 */

import { Notification } from '../../../app/modules/notification/notification.model';
import { Types } from 'mongoose';
import { INotificationRecipient, NotificationType } from '../notification.types';

type DatabaseContent = {
  title?: string;
  text: string;
  type: NotificationType | string;
  referenceId?: string | Types.ObjectId;
}

type DatabaseResult = {
  sent: number;
  failed: string[];
}

/**
 * Save notifications to MongoDB
 */
export const saveToDatabase = async (
  users: INotificationRecipient[],
  content: DatabaseContent
): Promise<DatabaseResult> => {
  const result: DatabaseResult = { sent: 0, failed: [] };

  const notifications = users.map(user => ({
    title: content.title,
    text: content.text,
    receiver: user._id,
    type: content.type || 'SYSTEM',
    referenceId: content.referenceId,
    isRead: false,
  }));

  try {
    const created = await Notification.insertMany(notifications, {
      ordered: false,
    });
    result.sent = created.length;
  } catch (error: any) {
    if (error.insertedDocs) {
      result.sent = error.insertedDocs.length;
      const insertedIds = new Set(
        error.insertedDocs.map((d: any) => d.receiver.toString())
      );
      result.failed = users
        .filter(u => !insertedIds.has(u._id.toString()))
        .map(u => u._id.toString());
    } else {
      console.error('Database insert error:', error);
      result.failed = users.map(u => u._id.toString());
    }
  }

  return result;
};

export default saveToDatabase;
