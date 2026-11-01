export type IEmailLayoutProps = {
  title?: string;
  previewText?: string;
  content: string;
}

/**
 * Bulletproof, modern, responsive HTML email layout wrapper for Moeb26.
 * Compatible with Gmail, Apple Mail, Outlook, and mobile screens.
 */
export const wrapInEmailLayout = ({
  title = 'Moeb26 Notification',
  previewText = '',
  content,
}: IEmailLayoutProps): string => {
  const currentYear = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
  <title>${title}</title>
  ${previewText ? `<span style="display:none;font-size:0px;line-height:0px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${previewText}</span>` : ''}
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    body {
      margin: 0;
      padding: 0;
      width: 100% !important;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
      background-color: #0F172A;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    img {
      border: 0;
      outline: none;
      text-decoration: none;
      -ms-interpolation-mode: bicubic;
    }
    table {
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    @media only screen and (max-width: 620px) {
      .container {
        width: 100% !important;
        padding: 16px !important;
      }
      .card {
        padding: 24px 16px !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #0F172A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0F172A; min-height: 100vh;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <!-- Main Container -->
        <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" border="0" style="width: 600px; max-width: 600px; margin: 0 auto;">
          <!-- Header / Logo -->
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <div style="display: inline-block; padding: 10px 20px; background: rgba(255, 255, 255, 0.05); border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.1);">
                <h1 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #F8FAFC; text-transform: uppercase;">MOEB<span style="color: #38BDF8;">26</span></h1>
              </div>
            </td>
          </tr>

          <!-- Content Card -->
          <tr>
            <td>
              <table role="presentation" class="card" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #1E293B; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4); padding: 32px 28px;">
                <tr>
                  <td>
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 32px; color: #64748B; font-size: 13px; line-height: 20px;">
              <p style="margin: 0 0 8px 0;">This is an automated notification from the Moeb26 Chauffeur Platform.</p>
              <p style="margin: 0 0 8px 0;">If you did not request this email, you can safely ignore it.</p>
              <p style="margin: 0; color: #475569;">&copy; ${currentYear} Moeb26 Inc. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
