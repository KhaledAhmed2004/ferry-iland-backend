import { NotificationModel } from './notification.model';
import { IListNotificationOptions, INotification } from './notification.interface';
import ApiError from '../../../errors/ApiError';
import { StatusCodes } from 'http-status-codes';
import mongoose, { FilterQuery } from 'mongoose';

const getNotificationsByCursor = async (
  userId: string,
  limit: number,
  cursor?: string,
) => {
  const query: FilterQuery<INotification> = {
    receiver: new mongoose.Types.ObjectId(userId),
  };

  if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
    query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const items = await NotificationModel.find(query)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const nextCursor =
    hasMore && data.length > 0
      ? data[data.length - 1]._id?.toString() || null
      : null;

  return {
    type: 'cursor' as const,
    cursor: {
      nextCursor,
      hasMore,
      limit,
    },
    data,
  };
};

const getNotificationsByOffset = async (
  userId: string,
  limit: number,
  pageNumber?: number,
) => {
  const page = Math.max(1, Number(pageNumber) || 1);
  const skip = (page - 1) * limit;

  const [data, total, unreadCount] = await Promise.all([
    NotificationModel.find({ receiver: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    NotificationModel.countDocuments({ receiver: userId }),
    NotificationModel.countDocuments({ receiver: userId, isRead: false }),
  ]);

  return {
    type: 'offset' as const,
    pagination: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit) || 1,
      unreadCount,
    },
    data,
  };
};

const getOwnedNotification = async (notificationId: string, userId: string) => {
  const notification = await NotificationModel.findById(notificationId);
  if (!notification) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification not found');
  }
  if (notification.receiver?.toString() !== userId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Not authorized');
  }
  return notification;
};

const getUserNotifications = async (
  userId: string,
  options?: IListNotificationOptions,
) => {
  const limit = Math.max(1, Number(options?.limit) || 20);

  if (options?.cursor !== undefined) {
    return getNotificationsByCursor(userId, limit, options.cursor);
  }

  return getNotificationsByOffset(userId, limit, options?.page);
};

const markAllRead = async (userId: string) => {
  await NotificationModel.updateMany(
    { receiver: userId, isRead: false },
    { $set: { isRead: true, read: true } },
  );
  return { updated: true };
};

const markRead = async (
  notificationId: string,
  userId: string,
  read = true,
) => {
  const notification = await getOwnedNotification(notificationId, userId);
  notification.isRead = read;
  notification.read = read;
  await notification.save();
  return notification;
};

const deleteNotification = async (notificationId: string, userId: string) => {
  const notification = await getOwnedNotification(notificationId, userId);
  await notification.deleteOne();
  return { deleted: true };
};

export const NotificationService = {
  getUserNotifications,
  markAllRead,
  markRead,
  deleteNotification,
};

