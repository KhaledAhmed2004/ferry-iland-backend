/**
 * Payment Failed Notification Template
 */

import { INotificationTemplate } from '../notification.types';

export const paymentFailed: INotificationTemplate = {
  name: 'paymentFailed',

  push: {
    title: 'Payment Failed',
    body: 'Your payment of {{currency}}{{amount}} could not be processed. {{reason}}',
    data: {
      type: 'PAYMENT_FAILED',
      amount: '{{amount}}',
      currency: '{{currency}}',
      action: 'RETRY_PAYMENT',
    },
  },

  socket: {
    event: 'PAYMENT_FAILED',
    data: {
      type: 'PAYMENT_FAILED',
      amount: '{{amount}}',
      currency: '{{currency}}',
      reason: '{{reason}}',
    },
  },

  database: {
    type: 'PAYMENT',
    title: 'Payment Failed',
    text: 'Your payment of {{currency}}{{amount}} could not be processed. {{reason}}',
  },
};

export default paymentFailed;
