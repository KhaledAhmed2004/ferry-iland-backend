import { IInvoiceEmailData, ISendEmailOptions } from '../email.types';
import { wrapInEmailLayout } from '../email.layout';

export const invoiceTemplate = (data: IInvoiceEmailData): ISendEmailOptions => {
  const content = `
    <h2 style="margin: 0 0 16px 0; color: #F8FAFC; font-size: 20px; font-weight: 700; text-align: center;">Trip Receipt / Payment Confirmation</h2>
    <p style="margin: 0 0 20px 0; color: #94A3B8; font-size: 15px; line-height: 24px; text-align: center;">
      Hi <strong style="color: #F8FAFC;">${data.name}</strong>,<br>
      Thank you for riding with Moeb26. Your payment has been processed successfully.
    </p>

    <!-- Invoice Details Table -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0F172A; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.08); padding: 16px; margin: 20px 0;">
      <tr>
        <td style="padding: 8px 12px; color: #64748B; font-size: 14px;">Invoice #</td>
        <td style="padding: 8px 12px; color: #F8FAFC; font-size: 14px; font-weight: 600; text-align: right;">${data.invoiceNumber}</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; color: #64748B; font-size: 14px;">Date</td>
        <td style="padding: 8px 12px; color: #F8FAFC; font-size: 14px; text-align: right;">${data.date}</td>
      </tr>
      ${data.serviceType ? `
      <tr>
        <td style="padding: 8px 12px; color: #64748B; font-size: 14px;">Service Type</td>
        <td style="padding: 8px 12px; color: #F8FAFC; font-size: 14px; text-align: right;">${data.serviceType}</td>
      </tr>` : ''}
      ${data.paymentMethod ? `
      <tr>
        <td style="padding: 8px 12px; color: #64748B; font-size: 14px;">Payment Method</td>
        <td style="padding: 8px 12px; color: #F8FAFC; font-size: 14px; text-align: right;">${data.paymentMethod}</td>
      </tr>` : ''}
      <tr>
        <td colspan="2" style="padding: 8px 12px;"><hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.1); margin: 4px 0;"></td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; color: #F8FAFC; font-size: 16px; font-weight: 700;">Total Paid</td>
        <td style="padding: 8px 12px; color: #38BDF8; font-size: 20px; font-weight: 800; text-align: right;">$${data.amount}</td>
      </tr>
    </table>

    ${data.downloadUrl ? `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
      <tr>
        <td align="center">
          <a href="${data.downloadUrl}" style="display: inline-block; background: #0284C7; color: #FFFFFF; font-size: 14px; font-weight: 600; text-decoration: none; padding: 10px 24px; border-radius: 8px;">
            📄 Download Invoice PDF
          </a>
        </td>
      </tr>
    </table>` : ''}
  `;

  return {
    to: data.email,
    subject: `Your Moeb26 Receipt [Invoice #${data.invoiceNumber}]`,
    html: wrapInEmailLayout({
      title: `Invoice #${data.invoiceNumber}`,
      previewText: `Moeb26 payment receipt for $${data.amount}`,
      content,
    }),
  };
};
