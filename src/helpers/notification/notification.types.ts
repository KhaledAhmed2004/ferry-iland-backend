/**
 * Notification Type Definitions
 */

import { Types } from 'mongoose';

export type NotificationType =
  | 'ADMIN'
  | 'BID'
  | 'BID_ACCEPTED'
  | 'BOOKING'
  | 'TASK'
  | 'SYSTEM'
  | 'DELIVERY_SUBMITTED'
  | 'PAYMENT_PENDING'
  | 'ORDER'
  | 'PAYMENT'
  | 'MESSAGE';

export type INotificationTemplate = {
  name: string;
  push?: {
    title: string;
    body: string;
    icon?: string;
    image?: string;
    data?: Record<string, string>;
  };
  socket?: {
    event: string;
    data?: Record<string, any>;
  };
  email?: {
    template: string;
    subject: string;
    theme?: string;
  };
  database?: {
    type: NotificationType;
    title?: string;
    text: string;
  };
}

export type INotificationContent = {
  title?: string;
  text?: string;
  type?: NotificationType;
  referenceId?: string | Types.ObjectId;
  data?: Record<string, any>;
  icon?: string;
  image?: string;
}

export type INotificationResult = {
  success: boolean;
  sent: {
    push: number;
    socket: number;
    email: number;
    database: number;
  };
  failed: {
    push: string[];
    socket: string[];
    email: string[];
    database: string[];
  };
  scheduled?: string;
}

export type INotificationBuilderOptions = {
  defaultChannels?: ('push' | 'socket' | 'email' | 'database')[];
  throwOnError?: boolean;
}

export type INotificationRecipient = {
  _id: Types.ObjectId | any;
  email?: string;
  deviceTokens?: string[];
  role?: string;
  name?: string;
}
