import { INotificationEmailData, ISendEmailOptions } from '../email.types';
import { wrapInEmailLayout } from '../email.layout';

export const notificationTemplate = (data: INotificationEmailData): ISendEmailOptions => {
  const content = `
    <h2 style="margin: 0 0 16px 0; color: #F8FAFC; font-size: 20px; font-weight: 700; text-align: center;">${data.title}</h2>
    ${data.name ? `
    <p style="margin: 0 0 16px 0; color: #CBD5E1; font-size: 15px;">
      Hello <strong style="color: #F8FAFC;">${data.name}</strong>,
    </p>` : ''}
    <p style="margin: 0 0 24px 0; color: #94A3B8; font-size: 15px; line-height: 24px;">
      ${data.message}
    </p>

    ${data.actionText && data.actionUrl ? `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 28px 0;">
      <tr>
        <td align="center">
          <a href="${data.actionUrl}" style="display: inline-block; background: #0284C7; color: #FFFFFF; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);">
            ${data.actionText}
          </a>
        </td>
      </tr>
    </table>` : ''}
  `;

  return {
    to: data.email,
    subject: `${data.title} - Moeb26`,
    html: wrapInEmailLayout({
      title: data.title,
      previewText: data.message.slice(0, 100),
      content,
    }),
  };
};
