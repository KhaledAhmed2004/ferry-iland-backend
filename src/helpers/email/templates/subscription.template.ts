import { ISubscriptionInviteEmailData, ISendEmailOptions } from '../email.types';
import { wrapInEmailLayout } from '../email.layout';

export const subscriptionInvitationTemplate = (data: ISubscriptionInviteEmailData): ISendEmailOptions => {
  const content = `
    <h2 style="margin: 0 0 16px 0; color: #F8FAFC; font-size: 20px; font-weight: 700; text-align: center;">Subscription Plan Invitation</h2>
    <p style="margin: 0 0 20px 0; color: #94A3B8; font-size: 15px; line-height: 24px; text-align: center;">
      Hello <strong style="color: #F8FAFC;">${data.name}</strong>,<br>
      You are invited to join the <strong>${data.planName || 'Moeb26 Premium Driver Plan'}</strong>.
    </p>

    <div style="background-color: #0F172A; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.08); padding: 20px; margin: 24px 0; text-align: center;">
      <p style="margin: 0 0 6px 0; color: #64748B; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Plan Amount</p>
      <div style="color: #38BDF8; font-size: 28px; font-weight: 800;">
        $${data.amount || '0.00'}<span style="font-size: 14px; color: #94A3B8; font-weight: normal;"> / month</span>
      </div>
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 28px 0;">
      <tr>
        <td align="center">
          <a href="${data.paymentUrl || 'https://moeb26.com/subscription'}" style="display: inline-block; background: #0284C7; color: #FFFFFF; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);">
            Activate Subscription
          </a>
        </td>
      </tr>
    </table>
  `;

  return {
    to: data.email,
    subject: 'Complete Your Moeb26 Subscription',
    html: wrapInEmailLayout({
      title: 'Subscription Invitation',
      previewText: `Activate your ${data.planName || 'Moeb26'} subscription.`,
      content,
    }),
  };
};
