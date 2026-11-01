import { Model, Types } from 'mongoose';

export type NotificationLink = {
  label: string;
  url: string;
};

export type INotification = {
  _id?: Types.ObjectId;
  text?: string;
  receiver?: Types.ObjectId | string;
  referenceId?: Types.ObjectId | string;
  metadata?: Record<string, unknown>;
  isRead?: boolean;
  userId?: string;
  type?:
    | 'EVENT_SCHEDULED'
    | 'GENERAL'
    | 'ADMIN'
    | 'SYSTEM'
    | 'MESSAGE'
    | 'RATING'
    | 'PAYMENT'
    | 'REMINDER'
    | 'JOB_INVITATION'
    | (string & {});

  title?: string;
  subtitle?: string;
  link?: NotificationLink;
  resourceType?: string;
  resourceId?: string;
  read?: boolean;
  icon?: string;
  expiresAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

export type Notification = INotification;
export type NotificationModel = Model<INotification, Record<string, unknown>>;

export type IListNotificationOptions = {
  page?: number;
  limit?: number;
  cursor?: string;
}
