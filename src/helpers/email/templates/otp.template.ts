import { ICreateAccountEmailData, IResetPasswordEmailData, ISendEmailOptions } from '../email.types';
import { wrapInEmailLayout } from '../email.layout';

export const createAccountOtpTemplate = (data: ICreateAccountEmailData): ISendEmailOptions => {
  const content = `
    <h2 style="margin: 0 0 16px 0; color: #F8FAFC; font-size: 20px; font-weight: 700; text-align: center;">Verify Your Email Address</h2>
    <p style="margin: 0 0 20px 0; color: #94A3B8; font-size: 15px; line-height: 24px; text-align: center;">
      Hello <strong style="color: #F8FAFC;">${data.name}</strong>,<br>
      Thank you for registering with Moeb26. Please use the 6-digit verification code below to verify your account:
    </p>

    <!-- OTP Display Box -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 28px 0;">
      <tr>
        <td align="center">
          <div style="display: inline-block; background: linear-gradient(135deg, #0284C7, #0369A1); color: #FFFFFF; font-size: 32px; font-weight: 800; letter-spacing: 8px; padding: 14px 28px; border-radius: 12px; box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4); text-align: center;">
            ${data.otp}
          </div>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 8px 0; color: #E2E8F0; font-size: 14px; text-align: center;">
      ⏳ This verification code expires in <strong>3 minutes</strong>.
    </p>
    <p style="margin: 0; color: #64748B; font-size: 13px; text-align: center;">
      For security reasons, never share this code with anyone.
    </p>
  `;

  return {
    to: data.email,
    subject: 'Verify your account - Moeb26',
    html: wrapInEmailLayout({
      title: 'Verify your account',
      previewText: `Your Moeb26 verification code is ${data.otp}`,
      content,
    }),
  };
};

export const resetPasswordOtpTemplate = (data: IResetPasswordEmailData): ISendEmailOptions => {
  const content = `
    <h2 style="margin: 0 0 16px 0; color: #F8FAFC; font-size: 20px; font-weight: 700; text-align: center;">Reset Your Password</h2>
    <p style="margin: 0 0 20px 0; color: #94A3B8; font-size: 15px; line-height: 24px; text-align: center;">
      We received a request to reset your password. Use the single-use authorization code below:
    </p>

    <!-- OTP Display Box -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 28px 0;">
      <tr>
        <td align="center">
          <div style="display: inline-block; background: linear-gradient(135deg, #D97706, #B45309); color: #FFFFFF; font-size: 32px; font-weight: 800; letter-spacing: 8px; padding: 14px 28px; border-radius: 12px; box-shadow: 0 4px 14px rgba(217, 119, 6, 0.4); text-align: center;">
            ${data.otp}
          </div>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 8px 0; color: #E2E8F0; font-size: 14px; text-align: center;">
      ⏳ This code is valid for <strong>3 minutes</strong>.
    </p>
    <p style="margin: 0; color: #64748B; font-size: 13px; text-align: center;">
      If you did not request a password reset, please secure your account immediately.
    </p>
  `;

  return {
    to: data.email,
    subject: 'Reset your password - Moeb26',
    html: wrapInEmailLayout({
      title: 'Reset your password',
      previewText: `Your Moeb26 password reset code is ${data.otp}`,
      content,
    }),
  };
};
