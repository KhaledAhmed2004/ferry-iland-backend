export type ISendEmailOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export type ICreateAccountEmailData = {
  name: string;
  email: string;
  otp: number | string;
}

export type IResetPasswordEmailData = {
  email: string;
  otp: number | string;
  name?: string;
}

export type IAccountApprovedEmailData = {
  name: string;
  email: string;
  loginUrl?: string;
}

export type ISubscriptionInviteEmailData = {
  name: string;
  email: string;
  planName?: string;
  amount?: number | string;
  paymentUrl?: string;
}

export type IInvoiceEmailData = {
  name: string;
  email: string;
  invoiceNumber: string;
  date: string;
  amount: number | string;
  pickup?: string;
  dropoff?: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  serviceType?: string;
  paymentMethod?: string;
  downloadUrl?: string;
}

export type INotificationEmailData = {
  name?: string;
  email: string;
  title: string;
  message: string;
  actionText?: string;
  actionUrl?: string;
}
