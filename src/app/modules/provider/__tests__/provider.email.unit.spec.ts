import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Operator access emails. Suspending an operator revokes every session and
 * cancels their unbooked upcoming sailings, so the operator is already signed
 * out when the mail lands -- it has to carry the whole story. The database and
 * the mail transport are the boundaries here, so both are fakes.
 */

const { sendEmailOrThrow, operatorFindUniqueOrThrow } = vi.hoisted(() => ({
  sendEmailOrThrow: vi.fn(),
  operatorFindUniqueOrThrow: vi.fn(),
}));

vi.mock('../../../../shared/prisma', () => ({
  prisma: { operatorProfile: { findUniqueOrThrow: operatorFindUniqueOrThrow } },
  default: { operatorProfile: { findUniqueOrThrow: operatorFindUniqueOrThrow } },
}));

vi.mock('../../../../helpers/email', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../helpers/email')>();
  return { ...actual, EmailService: { sendEmailOrThrow } };
});

import { ProviderEmails } from '../provider.email';

const PROVIDER_ID = 'provider-1';

const lastMail = () => sendEmailOrThrow.mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  operatorFindUniqueOrThrow.mockResolvedValue({
    companyName: 'Lagoon Ferries Ltd',
    contactPersonName: 'Nadia Hassan',
    user: { name: 'Nadia H', email: 'ops@lagoonferries.test' },
  });
  sendEmailOrThrow.mockResolvedValue(undefined);
});

describe('ProviderEmails.sendOperatorSuspended', () => {
  it('tells the operator they are suspended and signed out everywhere', async () => {
    await ProviderEmails.sendOperatorSuspended(PROVIDER_ID, 0);

    const mail = lastMail();
    expect(mail.to).toBe('ops@lagoonferries.test');
    expect(mail.subject).toContain('Your operator account is suspended');
    expect(mail.html).toContain('Lagoon Ferries Ltd');
    expect(mail.html).toContain('Nadia Hassan');
    expect(mail.html).toContain('signed out everywhere');
  });

  it('reports how many sailings were cancelled, and that booked ones were not', async () => {
    await ProviderEmails.sendOperatorSuspended(PROVIDER_ID, 4);

    const mail = lastMail();
    expect(mail.html).toContain('<strong>4</strong> upcoming sailings');
    expect(mail.html).toContain('still travel as planned');
  });

  it('uses the singular for a single cancelled sailing', async () => {
    await ProviderEmails.sendOperatorSuspended(PROVIDER_ID, 1);

    const mail = lastMail();
    expect(mail.html).toContain('<strong>1</strong> upcoming sailing with');
    expect(mail.html).toContain('was cancelled');
    expect(mail.html).not.toContain('sailings');
  });

  it('says plainly when nothing was cancelled', async () => {
    await ProviderEmails.sendOperatorSuspended(PROVIDER_ID, 0);

    const mail = lastMail();
    expect(mail.html).toContain('No upcoming sailings were cancelled');
  });

  it('never throws, so a mail problem cannot undo the suspension', async () => {
    sendEmailOrThrow.mockRejectedValue(new Error('smtp down'));

    await expect(
      ProviderEmails.sendOperatorSuspended(PROVIDER_ID, 2),
    ).resolves.toBeUndefined();
  });
});

describe('ProviderEmails.sendOperatorReactivated', () => {
  it('confirms the account is usable again', async () => {
    await ProviderEmails.sendOperatorReactivated(PROVIDER_ID);

    const mail = lastMail();
    expect(mail.to).toBe('ops@lagoonferries.test');
    expect(mail.subject).toContain('Your operator account is active again');
    expect(mail.html).toContain('Lagoon Ferries Ltd');
  });

  it('warns that the cancelled sailings do not come back', async () => {
    await ProviderEmails.sendOperatorReactivated(PROVIDER_ID);

    const mail = lastMail();
    expect(mail.html).toContain('stay cancelled');
    expect(mail.html).toContain('recreate');
  });

  it('never throws when the operator profile cannot be loaded', async () => {
    operatorFindUniqueOrThrow.mockRejectedValue(new Error('no such profile'));

    await expect(
      ProviderEmails.sendOperatorReactivated(PROVIDER_ID),
    ).resolves.toBeUndefined();
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
  });
});
