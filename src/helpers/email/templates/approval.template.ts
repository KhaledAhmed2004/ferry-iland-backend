import { IAccountApprovedEmailData, ISendEmailOptions } from '../email.types';
import { wrapInEmailLayout } from '../email.layout';

export const accountApprovedTemplate = (data: IAccountApprovedEmailData): ISendEmailOptions => {
  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="display: inline-block; width: 56px; height: 56px; line-height: 56px; border-radius: 50%; background-color: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); font-size: 28px;">
        🎉
      </div>
    </div>

    <h2 style="margin: 0 0 16px 0; color: #F8FAFC; font-size: 22px; font-weight: 700; text-align: center;">Congratulations! Your Account is Approved</h2>
    <p style="margin: 0 0 20px 0; color: #94A3B8; font-size: 15px; line-height: 24px; text-align: center;">
      Hello <strong style="color: #F8FAFC;">${data.name}</strong>,<br>
      Your documents have been successfully reviewed and verified by our administrative team. Your chauffeur account is now fully active!
    </p>

    <div style="background-color: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 20px; margin: 24px 0; text-align: left;">
      <h4 style="margin: 0 0 8px 0; color: #34D399; font-size: 15px;">Next Steps:</h4>
      <ul style="margin: 0; padding-left: 20px; color: #CBD5E1; font-size: 14px; line-height: 22px;">
        <li>Log in to the Moeb26 Mobile Application</li>
        <li>Review your active service area and vehicle details</li>
        <li>Go online and start accepting high-end client trips</li>
      </ul>
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 28px 0;">
      <tr>
        <td align="center">
          <a href="${data.loginUrl || 'https://moeb26.com/login'}" style="display: inline-block; background: #0284C7; color: #FFFFFF; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);">
            Open Chauffeur App
          </a>
        </td>
      </tr>
    </table>
  `;

  return {
    to: data.email,
    subject: 'Account Approved - Welcome to Moeb26 Chauffeur Fleet',
    html: wrapInEmailLayout({
      title: 'Account Approved',
      previewText: 'Your Moeb26 Chauffeur account is now approved and active.',
      content,
    }),
  };
};
