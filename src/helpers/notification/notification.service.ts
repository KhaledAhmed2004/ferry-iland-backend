/**
 * NotificationService & NotificationBuilder
 *
 * Central multi-channel notification engine supporting:
 * - Push Notifications (Firebase FCM)
 * - Real-time Socket.IO Events
 * - Transactional & Notification Emails (EmailService)
 * - Database Persistence (MongoDB)
 * - Background Scheduled Notifications
 */

import { Types } from 'mongoose';
import { prisma } from '../../shared/prisma';
import * as templates from './templates';
import { sendPush } from './channels/push.channel';
import { sendSocket } from './channels/socket.channel';
import { sendEmail } from './channels/email.channel';
import { saveToDatabase } from './channels/database.channel';
import ScheduledNotification from './scheduler/ScheduledNotification.model';
import {
  NotificationType,
  INotificationTemplate,
  INotificationContent,
  INotificationResult,
  INotificationBuilderOptions,
  INotificationRecipient,
} from './notification.types';

// ==================== TEMPLATE REGISTRY ====================

const templateRegistry: Map<string, INotificationTemplate> = new Map();

// Initialize built-in templates
Object.entries(templates).forEach(([, template]) => {
  if (typeof template === 'object' && 'name' in template) {
    templateRegistry.set(template.name, template as INotificationTemplate);
  }
});

// ==================== NOTIFICATION BUILDER CLASS ====================

export class NotificationBuilder {
  private userIds: string[] = [];
  private excludeIds: string[] = [];
  private targetRole?: string;
  private template?: INotificationTemplate;
  private variables: Record<string, any> = {};
  private content: INotificationContent = {};
  private channels: Set<'push' | 'socket' | 'email' | 'database'> = new Set();
  private scheduledFor?: Date;
  private options: INotificationBuilderOptions;

  constructor(options?: INotificationBuilderOptions) {
    this.options = {
      defaultChannels: [],
      throwOnError: false,
      ...options,
    };

    this.options.defaultChannels?.forEach(channel => {
      this.channels.add(channel);
    });
  }

  // ===== RECIPIENTS =====

  to(recipient: string | Types.ObjectId | INotificationRecipient): this {
    if (typeof recipient === 'string') {
      this.userIds = [recipient];
    } else if (recipient instanceof Types.ObjectId) {
      this.userIds = [recipient.toString()];
    } else {
      this.userIds = [recipient._id.toString()];
    }
    return this;
  }

  toMany(recipients: (string | Types.ObjectId)[]): this {
    this.userIds = recipients.map(r =>
      typeof r === 'string' ? r : r.toString()
    );
    return this;
  }

  toRole(role: string): this {
    this.targetRole = role;
    return this;
  }

  except(userIds: (string | Types.ObjectId)[]): this {
    this.excludeIds = userIds.map(id =>
      typeof id === 'string' ? id : id.toString()
    );
    return this;
  }

  // ===== CONTENT =====

  useTemplate(templateName: string, variables?: Record<string, any>): this {
    const template = templateRegistry.get(templateName);
    if (!template) {
      throw new Error(
        `Template "${templateName}" not found. Available: ${Array.from(templateRegistry.keys()).join(', ')}`
      );
    }
    this.template = template;
    if (variables) {
      this.variables = { ...this.variables, ...variables };
    }
    return this;
  }

  setTitle(title: string): this {
    this.content.title = title;
    return this;
  }

  setText(text: string): this {
    this.content.text = text;
    return this;
  }

  setType(type: NotificationType): this {
    this.content.type = type;
    return this;
  }

  setReference(referenceId: string | Types.ObjectId): this {
    this.content.referenceId = referenceId;
    return this;
  }

  setData(data: Record<string, any>): this {
    this.content.data = { ...this.content.data, ...data };
    return this;
  }

  setIcon(iconUrl: string): this {
    this.content.icon = iconUrl;
    return this;
  }

  setImage(imageUrl: string): this {
    this.content.image = imageUrl;
    return this;
  }

  // ===== CHANNELS =====

  viaPush(): this {
    this.channels.add('push');
    return this;
  }

  viaSocket(): this {
    this.channels.add('socket');
    return this;
  }

  viaEmail(): this {
    this.channels.add('email');
    return this;
  }

  viaDatabase(): this {
    this.channels.add('database');
    return this;
  }

  viaAll(): this {
    this.channels.add('push');
    this.channels.add('socket');
    this.channels.add('email');
    this.channels.add('database');
    return this;
  }

  viaRealtime(): this {
    this.channels.add('push');
    this.channels.add('socket');
    return this;
  }

  viaPushIf(condition: boolean): this {
    if (condition) this.channels.add('push');
    return this;
  }

  viaEmailIf(condition: boolean): this {
    if (condition) this.channels.add('email');
    return this;
  }

  viaSocketIf(condition: boolean): this {
    if (condition) this.channels.add('socket');
    return this;
  }

  viaDatabaseIf(condition: boolean): this {
    if (condition) this.channels.add('database');
    return this;
  }

  // ===== SCHEDULING =====

  schedule(date: Date): this {
    this.scheduledFor = date;
    return this;
  }

  scheduleAfter(duration: string): this {
    const match = duration.match(/^(\d+)(m|h|d|w)$/);
    if (!match) {
      throw new Error(
        'Invalid duration format. Use: 5m (minutes), 2h (hours), 1d (days), 1w (weeks)'
      );
    }

    const value = parseInt(match[1]);
    const unit = match[2];

    const now = new Date();
    switch (unit) {
      case 'm':
        now.setMinutes(now.getMinutes() + value);
        break;
      case 'h':
        now.setHours(now.getHours() + value);
        break;
      case 'd':
        now.setDate(now.getDate() + value);
        break;
      case 'w':
        now.setDate(now.getDate() + value * 7);
        break;
    }

    this.scheduledFor = now;
    return this;
  }

  // ===== EXECUTION =====

  async sendNow(): Promise<INotificationResult> {
    const users = await this.resolveUsers();

    if (users.length === 0) {
      return {
        success: true,
        sent: { push: 0, socket: 0, email: 0, database: 0 },
        failed: { push: [], socket: [], email: [], database: [] },
      };
    }

    const resolvedContent = this.resolveContent();

    const result: INotificationResult = {
      success: true,
      sent: { push: 0, socket: 0, email: 0, database: 0 },
      failed: { push: [], socket: [], email: [], database: [] },
    };

    if (this.channels.has('push')) {
      try {
        const pushResult = await sendPush(users, {
          title: resolvedContent.push.title,
          body: resolvedContent.push.body,
          icon: resolvedContent.push.icon,
          image: resolvedContent.push.image,
          data: resolvedContent.push.data,
        });
        result.sent.push = pushResult.sent;
        result.failed.push = pushResult.failed;
      } catch (error) {
        console.error('Push channel error:', error);
        result.failed.push = users.map((u: any) => u._id.toString());
      }
    }

    if (this.channels.has('socket')) {
      try {
        const socketResult = await sendSocket(users, {
          event: resolvedContent.socket.event,
          data: resolvedContent.socket.data,
        });
        result.sent.socket = socketResult.sent;
        result.failed.socket = socketResult.failed;
      } catch (error) {
        console.error('Socket channel error:', error);
        result.failed.socket = users.map((u: any) => u._id.toString());
      }
    }

    if (this.channels.has('email')) {
      try {
        const emailResult = await sendEmail(users, {
          template: resolvedContent.email.template,
          subject: resolvedContent.email.subject,
          theme: resolvedContent.email.theme,
          variables: this.variables,
        });
        result.sent.email = emailResult.sent;
        result.failed.email = emailResult.failed;
      } catch (error) {
        console.error('Email channel error:', error);
        result.failed.email = users.map((u: any) => u._id.toString());
      }
    }

    if (this.channels.has('database')) {
      try {
        const dbResult = await saveToDatabase(users, {
          title: resolvedContent.database.title,
          text: resolvedContent.database.text,
          type: resolvedContent.database.type,
          referenceId: this.content.referenceId,
        });
        result.sent.database = dbResult.sent;
        result.failed.database = dbResult.failed;
      } catch (error) {
        console.error('Database channel error:', error);
        result.failed.database = users.map((u: any) => u._id.toString());
      }
    }

    const totalFailed =
      result.failed.push.length +
      result.failed.socket.length +
      result.failed.email.length +
      result.failed.database.length;

    result.success = totalFailed === 0;
    return result;
  }

  async send(): Promise<INotificationResult> {
    if (this.userIds.length === 0 && !this.targetRole) {
      throw new Error('No recipients specified. Use .to(), .toMany(), or .toRole()');
    }

    if (!this.template && !this.content.text) {
      throw new Error('No content specified. Use .useTemplate() or .setText()');
    }

    if (this.channels.size === 0) {
      throw new Error('No channels specified. Use .viaPush(), .viaSocket(), .viaEmail(), .viaDatabase(), or .viaAll()');
    }

    if (this.scheduledFor && this.scheduledFor > new Date()) {
      return this.saveScheduled();
    }

    return this.sendNow();
  }

  private async resolveUsers(): Promise<INotificationRecipient[]> {
    const where: any = {};

    if (this.targetRole) {
      where.role = this.targetRole;
    }

    if (this.userIds.length > 0) {
      where.id = { in: this.userIds };
    } else if (!this.targetRole) {
      return [];
    }

    if (this.excludeIds.length > 0) {
      where.id = { ...(where.id || {}), notIn: this.excludeIds };
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
      },
    });

    return users.map(user => ({
      _id: user.id,
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      deviceTokens: [],
    })) as INotificationRecipient[];
  }

  private resolveContent(): {
    push: { title: string; body: string; icon?: string; image?: string; data?: Record<string, string> };
    socket: { event: string; data: Record<string, any> };
    email: { template: string; subject: string; theme?: string };
    database: { title?: string; text: string; type: NotificationType };
  } {
    const interpolate = (str: string, vars: Record<string, any>): string => {
      return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        if (vars[key] !== undefined && vars[key] !== null) {
          return String(vars[key]);
        }
        if (key === 'messagePreview' && (vars['preview'] || vars['message'] || vars['text'])) {
          return String(vars['preview'] || vars['message'] || vars['text']);
        }
        if (key === 'preview' && (vars['messagePreview'] || vars['message'] || vars['text'])) {
          return String(vars['messagePreview'] || vars['message'] || vars['text']);
        }
        if (key === 'senderName' && (vars['name'] || vars['userName'])) {
          return String(vars['name'] || vars['userName']);
        }
        if (key === 'currency') {
          return '$';
        }
        return '';
      });
    };

    let push = {
      title: this.content.title || 'Notification',
      body: this.content.text || '',
      icon: this.content.icon,
      image: this.content.image,
      data: this.content.data as Record<string, string> | undefined,
    };

    let socket = {
      event: 'NOTIFICATION',
      data: { ...this.content.data, message: this.content.text },
    };

    let email = {
      template: 'notification',
      subject: this.content.title || 'Notification',
      theme: 'default',
    };

    let database = {
      title: this.content.title,
      text: this.content.text || '',
      type: this.content.type || ('SYSTEM' as NotificationType),
    };

    if (this.template) {
      if (this.template.push) {
        push = {
          title: interpolate(this.template.push.title, this.variables),
          body: interpolate(this.template.push.body, this.variables),
          icon: this.template.push.icon || push.icon,
          image: this.template.push.image || push.image,
          data: this.template.push.data
            ? Object.fromEntries(
                Object.entries(this.template.push.data).map(([k, v]) => [
                  k,
                  interpolate(v, this.variables),
                ])
              )
            : push.data,
        };
      }

      if (this.template.socket) {
        socket = {
          event: this.template.socket.event,
          data: this.template.socket.data
            ? JSON.parse(interpolate(JSON.stringify(this.template.socket.data), this.variables))
            : socket.data,
        };
      }

      if (this.template.email) {
        email = {
          template: this.template.email.template,
          subject: interpolate(this.template.email.subject, this.variables),
          theme: this.template.email.theme || 'default',
        };
      }

      if (this.template.database) {
        database = {
          title: this.template.database.title
            ? interpolate(this.template.database.title, this.variables)
            : undefined,
          text: interpolate(this.template.database.text, this.variables),
          type: this.template.database.type,
        };
      }
    }

    return { push, socket, email, database };
  }

  private async saveScheduled(): Promise<INotificationResult> {
    let recipientIds: string[] = [];

    if (this.targetRole) {
      const users = await prisma.user.findMany({
        where: { role: this.targetRole as any },
        select: { id: true },
      });
      recipientIds = users.map(u => u.id);
    } else {
      recipientIds = this.userIds;
    }

    if (this.excludeIds.length > 0) {
      recipientIds = recipientIds.filter(id => !this.excludeIds.includes(id));
    }

    const scheduled = await ScheduledNotification.create({
      recipients: recipientIds,
      template: this.template?.name,
      variables: this.variables,
      title: this.content.title,
      text: this.content.text,
      type: this.content.type,
      referenceId: this.content.referenceId,
      data: this.content.data,
      channels: Array.from(this.channels),
      scheduledFor: this.scheduledFor,
      status: 'pending',
    });

    return {
      success: true,
      sent: { push: 0, socket: 0, email: 0, database: 0 },
      failed: { push: [], socket: [], email: [], database: [] },
      scheduled: (scheduled._id as any).toString(),
    };
  }
}

// ==================== NOTIFICATION SERVICE FACADE ====================

export type IQuickSendOptions = {
  to: string | Types.ObjectId | (string | Types.ObjectId)[] | INotificationRecipient;
  template?: string;
  variables?: Record<string, any>;
  title?: string;
  text?: string;
  type?: NotificationType;
  referenceId?: string | Types.ObjectId;
  data?: Record<string, any>;
  channels?: ('push' | 'socket' | 'email' | 'database')[];
  scheduleFor?: Date;
}

export const NotificationService = {
  /**
   * Instantiate a new fluent chainable NotificationBuilder
   */
  create: (options?: INotificationBuilderOptions): NotificationBuilder => {
    return new NotificationBuilder(options);
  },

  /**
   * Alias for create()
   */
  builder: (options?: INotificationBuilderOptions): NotificationBuilder => {
    return new NotificationBuilder(options);
  },

  /**
   * Quick one-line notification dispatcher
   */
  send: async (options: IQuickSendOptions): Promise<INotificationResult> => {
    const builder = new NotificationBuilder();

    if (Array.isArray(options.to)) {
      builder.toMany(options.to);
    } else {
      builder.to(options.to as any);
    }

    if (options.template) {
      builder.useTemplate(options.template, options.variables);
    }
    if (options.title) builder.setTitle(options.title);
    if (options.text) builder.setText(options.text);
    if (options.type) builder.setType(options.type);
    if (options.referenceId) builder.setReference(options.referenceId);
    if (options.data) builder.setData(options.data);

    if (options.channels && options.channels.length > 0) {
      options.channels.forEach(ch => {
        switch (ch) {
          case 'push': builder.viaPush(); break;
          case 'socket': builder.viaSocket(); break;
          case 'email': builder.viaEmail(); break;
          case 'database': builder.viaDatabase(); break;
        }
      });
    } else {
      // Default to all channels
      builder.viaAll();
    }

    if (options.scheduleFor) {
      builder.schedule(options.scheduleFor);
    }

    return builder.send();
  },

  /**
   * Quick convenience method to send a templated notification to a single user
   */
  sendToUser: async (
    userId: string | Types.ObjectId,
    template: string,
    variables?: Record<string, any>,
    channels: ('push' | 'socket' | 'email' | 'database')[] = ['push', 'socket', 'database']
  ): Promise<INotificationResult> => {
    return NotificationService.send({
      to: userId,
      template,
      variables,
      channels,
    });
  },

  /**
   * Quick convenience method to broadcast to an entire user role
   */
  sendToRole: async (
    role: string,
    template: string,
    variables?: Record<string, any>,
    channels: ('push' | 'socket' | 'email' | 'database')[] = ['push', 'socket', 'database']
  ): Promise<INotificationResult> => {
    const builder = new NotificationBuilder().toRole(role).useTemplate(template, variables);
    channels.forEach(ch => {
      switch (ch) {
        case 'push': builder.viaPush(); break;
        case 'socket': builder.viaSocket(); break;
        case 'email': builder.viaEmail(); break;
        case 'database': builder.viaDatabase(); break;
      }
    });
    return builder.send();
  },

  // Template registry management
  registerTemplate: (name: string, template: INotificationTemplate): void => {
    templateRegistry.set(name, template);
  },

  getTemplate: (name: string): INotificationTemplate | undefined => {
    return templateRegistry.get(name);
  },

  listTemplates: (): string[] => {
    return Array.from(templateRegistry.keys());
  },

  // Scheduler helpers
  cancelScheduled: async (scheduledId: string): Promise<boolean> => {
    const result = await ScheduledNotification.updateOne(
      { _id: scheduledId, status: 'pending' },
      { status: 'cancelled' }
    );
    return result.modifiedCount > 0;
  },

  getPending: async (userId?: string): Promise<any[]> => {
    const query: any = { status: 'pending' };
    if (userId) query.recipients = userId;
    return ScheduledNotification.find(query).sort({ scheduledFor: 1 });
  },
};

export default NotificationService;
