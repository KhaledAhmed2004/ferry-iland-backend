/**
 * Unified Notification Helper Subsystem
 *
 * Central export for multi-channel notifications (Push, Socket, Email, Database),
 * scheduler service, templates, and the NotificationService / NotificationBuilder APIs.
 */

export * from './notification.types';
export * from './notification.service';
export { NotificationService, NotificationBuilder, default } from './notification.service';
export { NotificationScheduler, ScheduledNotification } from './scheduler';
export type { IScheduledNotification } from './scheduler';
export * as notificationTemplates from './templates';
