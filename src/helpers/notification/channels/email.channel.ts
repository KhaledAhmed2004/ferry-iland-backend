/**
 * Email Channel - EmailService Integration
 *
 * Sends email notifications using the centralized EmailService.
 */

import { EmailService } from '../../email';
import { INotificationRecipient } from '../notification.types';

type EmailContent = {
  template?: string;
  subject: string;
  theme?: string;
  variables: Record<string, any>;
}

type EmailResult = {
  sent: number;
  failed: string[];
}

/**
 * Send email notifications via EmailService
 */
export const sendEmail = async (
  users: INotificationRecipient[],
  content: EmailContent
): Promise<EmailResult> => {
  const result: EmailResult = { sent: 0, failed: [] };

  for (const user of users) {
    if (!user.email) {
      continue;
    }

    try {
      const variables: Record<string, any> = {
        ...content.variables,
        name: user.name || 'User',
        email: user.email,
        userId: user._id.toString(),
      };

      await EmailService.sendNotification({
        email: user.email,
        name: user.name,
        title: content.subject || 'Moeb26 Notification',
        message: variables.message || variables.text || 'You have a new notification.',
        actionText: variables.actionText,
        actionUrl: variables.actionUrl,
      });

      result.sent++;
    } catch (error) {
      console.error(`Email send error for user ${user._id}:`, error);
      result.failed.push(user._id.toString());
    }
  }

  return result;
};

export default sendEmail;
