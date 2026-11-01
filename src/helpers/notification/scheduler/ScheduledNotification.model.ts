/**
 * ScheduledNotification Model
 *
 * MongoDB model for storing scheduled notifications.
 */

import { Schema, model, Document, Types } from 'mongoose';

export type IScheduledNotification = {
  recipients: Types.ObjectId[];
  template?: string;
  variables?: Record<string, any>;
  title?: string;
  text?: string;
  type?: string;
  referenceId?: Types.ObjectId;
  data?: Record<string, any>;
  channels: ('push' | 'socket' | 'email' | 'database')[];
  scheduledFor: Date;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  result?: {
    sent?: {
      push?: number;
      socket?: number;
      email?: number;
      database?: number;
    };
    failed?: {
      push?: string[];
      socket?: string[];
      email?: string[];
      database?: string[];
    };
    processedAt?: Date;
    error?: string;
  };
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
} & Document

const ScheduledNotificationSchema = new Schema<IScheduledNotification>(
  {
    recipients: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    }],
    template: {
      type: String,
    },
    variables: {
      type: Schema.Types.Mixed,
    },
    title: {
      type: String,
    },
    text: {
      type: String,
    },
    type: {
      type: String,
      enum: [
        'ADMIN',
        'BID',
        'BID_ACCEPTED',
        'BOOKING',
        'TASK',
        'SYSTEM',
        'DELIVERY_SUBMITTED',
        'PAYMENT_PENDING',
        'ORDER',
        'PAYMENT',
        'MESSAGE',
      ],
      default: 'SYSTEM',
    },
    referenceId: {
      type: Schema.Types.ObjectId,
    },
    data: {
      type: Schema.Types.Mixed,
    },
    channels: [{
      type: String,
      enum: ['push', 'socket', 'email', 'database'],
      required: true,
    }],
    scheduledFor: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'sent', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    result: {
      sent: {
        push: Number,
        socket: Number,
        email: Number,
        database: Number,
      },
      failed: {
        push: [String],
        socket: [String],
        email: [String],
        database: [String],
      },
      processedAt: Date,
      error: String,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

ScheduledNotificationSchema.index(
  { scheduledFor: 1, status: 1 },
  { name: 'due_notifications_idx' }
);

ScheduledNotificationSchema.index(
  { recipients: 1, status: 1 },
  { name: 'user_scheduled_idx' }
);

export const ScheduledNotification = model<IScheduledNotification>(
  'ScheduledNotification',
  ScheduledNotificationSchema
);

export default ScheduledNotification;
