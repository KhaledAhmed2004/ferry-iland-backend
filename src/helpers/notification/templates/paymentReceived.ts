/**
 * Payment Received Notification Template
 */

import { INotificationTemplate } from '../notification.types';

export const paymentReceived: INotificationTemplate = {
  name: 'paymentReceived',

  push: {
    title: 'Payment Received',
    body: 'You received a payment of {{currency}}{{amount}} for {{description}}',
    data: {
      type: 'PAYMENT_RECEIVED',
      amount: '{{amount}}',
      currency: '{{currency}}',
      paymentId: '{{paymentId}}',
      action: 'VIEW_EARNINGS',
    },
  },

  socket: {
    event: 'PAYMENT_RECEIVED',
    data: {
      type: 'PAYMENT_RECEIVED',
      amount: '{{amount}}',
      currency: '{{currency}}',
      paymentId: '{{paymentId}}',
      description: '{{description}}',
    },
  },

  database: {
    type: 'PAYMENT',
    title: 'Payment Received',
    text: 'You received a payment of {{currency}}{{amount}} for {{description}}',
  },
};

export default paymentReceived;
