import nodemailer from 'nodemailer';
import config from '../../config';
import {
  ISendEmailOptions,
  ICreateAccountEmailData,
  IResetPasswordEmailData,
  IAccountApprovedEmailData,
  ISubscriptionInviteEmailData,
  IInvoiceEmailData,
  INotificationEmailData,
} from './email.types';
import * as templates from './templates';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: Number(config.email.port),
  secure: false,
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const EmailService = {
  /**
   * Raw send email method via nodemailer transporter
   */
  sendEmail: async (options: ISendEmailOptions): Promise<void> => {
    if (process.env.NODE_ENV === 'test' || !config.email.host) {
      return;
    }
    try {
      await transporter.sendMail({
        from: `"Moeb26" <${config.email.from}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
    } catch (error) {
      console.error('Failed to send email to:', options.to, error);
    }
  },

  /**
   * Send Account Verification OTP Email
   */
  sendCreateAccountOtp: async (data: ICreateAccountEmailData): Promise<void> => {
    const emailData = templates.createAccountOtpTemplate(data);
    await EmailService.sendEmail(emailData);
  },

  /**
   * Send Password Reset OTP Email
   */
  sendResetPasswordOtp: async (data: IResetPasswordEmailData): Promise<void> => {
    const emailData = templates.resetPasswordOtpTemplate(data);
    await EmailService.sendEmail(emailData);
  },

  /**
   * Send Driver Application Approved Email
   */
  sendAccountApproved: async (data: IAccountApprovedEmailData): Promise<void> => {
    const emailData = templates.accountApprovedTemplate(data);
    await EmailService.sendEmail(emailData);
  },

  /**
   * Send Subscription Invitation Email
   */
  sendSubscriptionInvitation: async (data: ISubscriptionInviteEmailData): Promise<void> => {
    const emailData = templates.subscriptionInvitationTemplate(data);
    await EmailService.sendEmail(emailData);
  },

  /**
   * Send Invoice / Trip Receipt Email
   */
  sendInvoice: async (data: IInvoiceEmailData): Promise<void> => {
    const emailData = templates.invoiceTemplate(data);
    await EmailService.sendEmail(emailData);
  },

  /**
   * Send Generic Notification Email
   */
  sendNotification: async (data: INotificationEmailData): Promise<void> => {
    const emailData = templates.notificationTemplate(data);
    await EmailService.sendEmail(emailData);
  },
};
