import { Schema, model } from 'mongoose';
import { IEmailOutbox, EmailOutboxModel } from './emailOutbox.interface';

const emailOutboxSchema = new Schema<IEmailOutbox, EmailOutboxModel>(
  {
    to: { type: String, required: true },
    type: { type: String, required: true },
    template: { type: String },
    encryptedPayload: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'SENT', 'RETRY', 'FAILED', 'FAILED_PERMANENT'],
      default: 'PENDING',
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lastAttemptAt: { type: Date },
    nextAttemptAt: { type: Date, default: Date.now },
    sentAt: { type: Date },
    lastError: { type: String },
    lockedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying by the worker
emailOutboxSchema.index({ status: 1, nextAttemptAt: 1 });

export const EmailOutbox = model<IEmailOutbox, EmailOutboxModel>('EmailOutbox', emailOutboxSchema);
