/**
 * Notification Scheduler Service
 *
 * Background job that processes scheduled notifications.
 */

import ScheduledNotification, { IScheduledNotification } from './ScheduledNotification.model';
import { NotificationBuilder } from '../notification.service';
import { logger } from '../../../shared/logger';

let cron: any = null;
try {
  cron = require('node-cron');
} catch (e) {
  // node-cron optional
}

export class NotificationScheduler {
  private static isRunning = false;
  private static cronJob: any = null;
  private static intervalId: NodeJS.Timeout | null = null;

  static start(): void {
    if (this.cronJob || this.intervalId) {
      console.warn('Notification scheduler already started');
      return;
    }

    if (cron) {
      this.cronJob = cron.schedule('* * * * *', async () => {
        await this.processScheduled();
      });
    } else {
      this.intervalId = setInterval(async () => {
        await this.processScheduled();
      }, 60000);
    }
    logger.info('Notification scheduler started');
  }

  static stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('Notification scheduler stopped');
  }

  static async processScheduled(): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    let processedCount = 0;

    try {
      const now = new Date();
      const query = { scheduledFor: { $lte: now }, status: 'pending' };
      const dueNotifications = await ScheduledNotification.find(query)
        .limit(100)
        .sort({ scheduledFor: 1 });

      for (const scheduled of dueNotifications) {
        try {
          await this.processSingle(scheduled);
          processedCount++;
        } catch (error) {
          logger.error('Failed to process scheduled notification', error);
        }
      }
    } catch (error) {
      logger.error('Notification scheduler error:', error);
    } finally {
      this.isRunning = false;
    }
    return processedCount;
  }

  private static async processSingle(scheduled: IScheduledNotification): Promise<void> {
    scheduled.status = 'processing';
    await scheduled.save();

    try {
      let builder = new NotificationBuilder();
      builder = builder.toMany(scheduled.recipients.map(id => id.toString()));

      if (scheduled.template) {
        builder = builder.useTemplate(scheduled.template, scheduled.variables || {});
      } else {
        if (scheduled.title) builder = builder.setTitle(scheduled.title);
        if (scheduled.text) builder = builder.setText(scheduled.text);
        if (scheduled.type) builder = builder.setType(scheduled.type as any);
        if (scheduled.referenceId) builder = builder.setReference(scheduled.referenceId);
        if (scheduled.data) builder = builder.setData(scheduled.data);
      }

      for (const channel of scheduled.channels) {
        switch (channel) {
          case 'push': builder = builder.viaPush(); break;
          case 'socket': builder = builder.viaSocket(); break;
          case 'email': builder = builder.viaEmail(); break;
          case 'database': builder = builder.viaDatabase(); break;
        }
      }

      const result = await builder.sendNow();
      scheduled.status = 'sent';
      scheduled.result = { sent: result.sent, failed: result.failed, processedAt: new Date() };
      await scheduled.save();
    } catch (error: any) {
      scheduled.status = 'failed';
      scheduled.result = { error: error.message, processedAt: new Date() };
      await scheduled.save();
      throw error;
    }
  }

  static async cancel(scheduledId: string): Promise<boolean> {
    const result = await ScheduledNotification.updateOne(
      { _id: scheduledId, status: 'pending' },
      { status: 'cancelled' }
    );
    return result.modifiedCount > 0;
  }

  static async getPending(userId?: string): Promise<IScheduledNotification[]> {
    const query: any = { status: 'pending' };
    if (userId) query.recipients = userId;
    return ScheduledNotification.find(query).sort({ scheduledFor: 1 }).lean();
  }

  static async getById(scheduledId: string): Promise<IScheduledNotification | null> {
    return ScheduledNotification.findById(scheduledId).lean();
  }

  static async cleanup(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const result = await ScheduledNotification.deleteMany({
      status: { $in: ['sent', 'failed', 'cancelled'] },
      updatedAt: { $lt: cutoffDate },
    });
    return result.deletedCount;
  }
}

export default NotificationScheduler;
