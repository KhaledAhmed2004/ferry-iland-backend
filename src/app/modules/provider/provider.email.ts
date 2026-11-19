import config from '../../../config';
import { prisma } from '../../../shared/prisma';
import { logger } from '../../../shared/logger';
import { EmailService, emailTemplates } from '../../../helpers/email';

/**
 * Operator access emails. An admin suspending an operator revokes every session
 * and cancels their unbooked upcoming sailings, which until now logged the
 * operator out with a bare 401 and no explanation. Each function here runs after
 * the status change has committed, loads what it needs itself, and never throws:
 * a mail problem is logged and the suspension stays applied.
 */

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const dashboardUrl = () =>
  config.frontend_url
    ? `${config.frontend_url.replace(/\/$/, '')}/dashboard`
    : undefined;

const send = async (label: string, run: () => Promise<void>) => {
  try {
    await run();
  } catch (error) {
    logger.error(`Operator email "${label}" failed: ${(error as Error)?.message}`);
  }
};

const loadOperator = async (providerId: string) => {
  const provider = await prisma.operatorProfile.findUniqueOrThrow({
    where: { id: providerId },
    select: {
      companyName: true,
      contactPersonName: true,
      user: { select: { name: true, email: true } },
    },
  });
  return {
    email: provider.user.email,
    name: provider.contactPersonName || provider.user.name,
    company: provider.companyName,
  };
};

const notify = (data: {
  email: string;
  name?: string;
  title: string;
  message: string;
  withDashboardLink?: boolean;
}) =>
  EmailService.sendEmailOrThrow(
    emailTemplates.notificationTemplate({
      email: data.email,
      name: data.name ? escapeHtml(data.name) : undefined,
      title: data.title,
      message: data.message,
      ...(data.withDashboardLink && dashboardUrl()
        ? { actionText: 'Open your dashboard', actionUrl: dashboardUrl() as string }
        : {}),
    }),
  );

/**
 * The admin suspended this operator: sessions are gone and unbooked upcoming
 * sailings were cancelled. Says so plainly, because the operator is already
 * logged out by the time this lands.
 */
const sendOperatorSuspended = (providerId: string, deactivatedTripsCount: number) =>
  send('operator suspended', async () => {
    const operator = await loadOperator(providerId);
    const trips =
      deactivatedTripsCount > 0
        ? `<br/><br/><strong>${deactivatedTripsCount}</strong> upcoming ${
            deactivatedTripsCount === 1 ? 'sailing' : 'sailings'
          } with no passengers booked ${
            deactivatedTripsCount === 1 ? 'was' : 'were'
          } cancelled. Sailings that already have bookings were left as they are, ` +
          'so your booked passengers still travel as planned.'
        : '<br/><br/>No upcoming sailings were cancelled, and your booked passengers still travel as planned.';

    await notify({
      email: operator.email,
      name: operator.name,
      title: 'Your operator account is suspended',
      message:
        `An administrator has suspended the operator account for <strong>${escapeHtml(operator.company)}</strong>. ` +
        'You have been signed out everywhere and cannot sign in again while the suspension is in place.' +
        trips +
        '<br/><br/>If you believe this is a mistake, reply to this email and our team will review it.',
    });
  });

/**
 * The admin put this operator back to ACTIVE. The cancelled sailings do not
 * come back, so the email says that outright rather than letting the operator
 * discover an empty schedule.
 */
const sendOperatorReactivated = (providerId: string) =>
  send('operator reactivated', async () => {
    const operator = await loadOperator(providerId);
    await notify({
      email: operator.email,
      name: operator.name,
      title: 'Your operator account is active again',
      message:
        `The operator account for <strong>${escapeHtml(operator.company)}</strong> is active again and you can sign in as usual. ` +
        'Any sailings that were cancelled while the account was suspended stay cancelled, so please recreate the ones you still want to run.',
      withDashboardLink: true,
    });
  });

export const ProviderEmails = {
  sendOperatorSuspended,
  sendOperatorReactivated,
};
