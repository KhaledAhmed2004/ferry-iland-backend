import {
  createAccountOtpTemplate,
  resetPasswordOtpTemplate,
  subscriptionInvitationTemplate,
  accountApprovedTemplate,
  notificationTemplate,
  invoiceTemplate,
} from '../helpers/email/templates';

type ICreateAccount = {
  name: string;
  email: string;
  otp: number | string;
};

type IResetPassword = {
  email: string;
  otp: number | string;
  name?: string;
};

type ISubscriptionInvitation = {
  name: string;
  email: string;
  subscriptionUrl?: string;
  planName?: string;
  amount?: number | string;
};

type IAccountApproved = {
  name: string;
  email: string;
  loginUrl?: string;
};

export const emailTemplate = {
  createAccount: (values: ICreateAccount) =>
    createAccountOtpTemplate({
      name: values.name,
      email: values.email,
      otp: values.otp,
    }),

  resetPassword: (values: IResetPassword) =>
    resetPasswordOtpTemplate({
      email: values.email,
      otp: values.otp,
      name: values.name,
    }),

  subscriptionInvitation: (values: ISubscriptionInvitation) =>
    subscriptionInvitationTemplate({
      name: values.name,
      email: values.email,
      paymentUrl: values.subscriptionUrl,
      planName: values.planName,
      amount: values.amount,
    }),

  accountApproved: (values: IAccountApproved) =>
    accountApprovedTemplate({
      name: values.name,
      email: values.email,
      loginUrl: values.loginUrl,
    }),

  invoice: invoiceTemplate,
  notification: notificationTemplate,
};

export default emailTemplate;
