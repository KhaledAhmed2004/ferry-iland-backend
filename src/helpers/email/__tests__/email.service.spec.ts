import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A transport that always fails, like an SMTP host that refuses the connection.
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail }) },
  createTransport: () => ({ sendMail }),
}));
vi.mock('../../../config', () => ({
  default: { email: { host: 'smtp.example.test', port: '587', from: 'noreply@example.test' } },
}));

import { EmailService } from '../email.service';

const mail = { to: 'lead@example.test', subject: 'Hi', html: '<p>Hi</p>' };

describe('EmailService transport failures', () => {
  const env = process.env.NODE_ENV;
  beforeEach(() => {
    // Both senders skip the transport in tests; switch that off so the real path runs.
    process.env.NODE_ENV = 'development';
    sendMail.mockReset().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1'));
  });
  afterEach(() => {
    process.env.NODE_ENV = env;
    vi.restoreAllMocks();
  });

  it('sendEmailOrThrow passes the failure to the caller (booking emails log it, spec 0004 AC-17)', async () => {
    await expect(EmailService.sendEmailOrThrow(mail)).rejects.toThrow('ECONNREFUSED');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('sendEmail still swallows the failure for its other callers', async () => {
    const printed = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(EmailService.sendEmail(mail)).resolves.toBeUndefined();
    expect(printed).toHaveBeenCalledWith('Failed to send email to:', mail.to, expect.any(Error));
  });
});
