import { IInvoiceEmailData, ISendEmailOptions } from '../email.types';
import { wrapInEmailLayout } from '../email.layout';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** A number is dollars (older callers); a string is shown as given, already formatted. */
const amountText = (amount: number | string) =>
  typeof amount === 'number' ? `$${amount.toFixed(2)}` : amount;

const row = (label: string, value: string) => `
      <tr>
        <td style="padding: 8px 12px; color: #64748B; font-size: 14px;">${escapeHtml(label)}</td>
        <td style="padding: 8px 12px; color: #F8FAFC; font-size: 14px; text-align: right;">${escapeHtml(value)}</td>
      </tr>`;

/** Payment receipt. Booking receipts pass the booking reference as `invoiceNumber` (feature 7). */
export const invoiceTemplate = (data: IInvoiceEmailData): ISendEmailOptions => {
  const amount = escapeHtml(amountText(data.amount));
  const rows = [
    row('Reference', data.invoiceNumber),
    row('Date', data.date),
    ...(data.serviceType ? [row('Service', data.serviceType)] : []),
    ...(data.rows ?? []).map(item => row(item.label, item.value)),
    ...(data.paymentMethod ? [row('Payment method', data.paymentMethod)] : []),
  ].join('');

  const button = (url: string, text: string) => `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
      <tr>
        <td align="center">
          <a href="${escapeHtml(url)}" style="display: inline-block; background: #0284C7; color: #FFFFFF; font-size: 14px; font-weight: 600; text-decoration: none; padding: 10px 24px; border-radius: 8px;">
            ${escapeHtml(text)}
          </a>
        </td>
      </tr>
    </table>`;

  const content = `
    <h2 style="margin: 0 0 16px 0; color: #F8FAFC; font-size: 20px; font-weight: 700; text-align: center;">Payment receipt</h2>
    <p style="margin: 0 0 20px 0; color: #94A3B8; font-size: 15px; line-height: 24px; text-align: center;">
      Hi <strong style="color: #F8FAFC;">${escapeHtml(data.name)}</strong>,<br>
      Thank you for booking with IslandHop. We received your payment and your booking is confirmed.
    </p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0F172A; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.08); padding: 16px; margin: 20px 0;">
      ${rows}
      <tr>
        <td colspan="2" style="padding: 8px 12px;"><hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.1); margin: 4px 0;"></td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; color: #F8FAFC; font-size: 16px; font-weight: 700;">Total paid</td>
        <td style="padding: 8px 12px; color: #38BDF8; font-size: 20px; font-weight: 800; text-align: right;">${amount}</td>
      </tr>
    </table>

    ${data.actionUrl ? button(data.actionUrl, data.actionText ?? 'View your booking') : ''}
    ${data.downloadUrl ? button(data.downloadUrl, 'Download receipt PDF') : ''}
  `;

  return {
    to: data.email,
    subject: `Your IslandHop receipt for ${data.invoiceNumber}`,
    html: wrapInEmailLayout({
      title: `Receipt ${escapeHtml(data.invoiceNumber)}`,
      previewText: `IslandHop payment receipt for ${amount}`,
      content,
    }),
  };
};
