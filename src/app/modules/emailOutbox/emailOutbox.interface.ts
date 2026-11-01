import { Model } from 'mongoose';

export type IEmailOutboxStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'RETRY' | 'FAILED' | 'FAILED_PERMANENT';

export type IEmailOutbox = {
  to: string;
  type: string;
  template?: string;
  encryptedPayload: string;
  status: IEmailOutboxStatus;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt?: Date;
  nextAttemptAt: Date;
  sentAt?: Date;
  lastError?: string;
  lockedAt?: Date;
}

export type EmailOutboxModel = Model<IEmailOutbox, Record<string, unknown>>;
