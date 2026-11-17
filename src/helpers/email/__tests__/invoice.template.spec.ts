import { describe, expect, it } from 'vitest';
import { createAccountOtpTemplate, invoiceTemplate, notificationTemplate } from '../templates';

const base = {
  name: 'Ann Lee',
  email: 'ann@example.test',
  invoiceNumber: 'FRY-20261111-ABCD',
  date: 'Nov 11, 2026',
  amount: '$61.50',
};

describe('receipt template (feature 7)', () => {
  it('shows reference, date, rows, amount, payment method and the booking link', () => {
    const mail = invoiceTemplate({
      ...base,
      rows: [
        { label: 'Trip', value: 'Philipsburg to Saba, Wed 11 Nov, 05:00 PM' },
        { label: 'Passengers', value: '2 adults, 1 child' },
      ],
      paymentMethod: 'Card',
      actionUrl: 'https://islandhop.test/manage-booking/FRY-20261111-ABCD',
      actionText: 'View your booking and tickets',
    });

    expect(mail.to).toBe('ann@example.test');
    expect(mail.subject).toBe('Your IslandHop receipt for FRY-20261111-ABCD');
    for (const text of [
      'FRY-20261111-ABCD',
      'Nov 11, 2026',
      'Philipsburg to Saba, Wed 11 Nov, 05:00 PM',
      '2 adults, 1 child',
      'Card',
      '$61.50',
      'https://islandhop.test/manage-booking/FRY-20261111-ABCD',
      'View your booking and tickets',
    ]) {
      expect(mail.html).toContain(text);
    }
  });

  it('escapes the name, row values and link', () => {
    const mail = invoiceTemplate({
      ...base,
      name: '<script>x</script>',
      rows: [{ label: 'Trip', value: 'A & B <i>' }],
      actionUrl: 'https://x.test/?a="b"',
    });

    expect(mail.html).not.toContain('<script>x</script>');
    expect(mail.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(mail.html).toContain('A &amp; B &lt;i&gt;');
    expect(mail.html).toContain('https://x.test/?a=&quot;b&quot;');
  });

  it('a number amount (older callers) is shown as dollars', () => {
    expect(invoiceTemplate({ ...base, amount: 12.5 }).html).toContain('$12.50');
  });
});

describe('IslandHop brand in every email (feature 7)', () => {
  const mails = [
    invoiceTemplate(base),
    notificationTemplate({ email: 'a@b.test', title: 'Hi', message: 'Hello' }),
    createAccountOtpTemplate({ name: 'Ann', email: 'a@b.test', otp: '123456' } as Parameters<typeof createAccountOtpTemplate>[0]),
  ];

  it.each(mails.map(m => [m.subject, m]))('%s names IslandHop and never the old brand', (_subject, mail) => {
    expect(mail.html).toContain('IslandHop');
    expect(`${mail.subject} ${mail.html}`).not.toMatch(/Moeb|Chauffeur/i);
    expect(mail.html).toContain('Island<span style="color: #38BDF8;">Hop</span>');
  });
});
