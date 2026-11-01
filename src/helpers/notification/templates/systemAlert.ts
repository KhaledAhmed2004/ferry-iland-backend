/**
 * System Alert Notification Template
 */

import { INotificationTemplate } from '../notification.types';

export const systemAlert: INotificationTemplate = {
  name: 'systemAlert',

  push: {
    title: 'System Alert: {{alertTitle}}',
    body: '{{alertMessage}}',
    data: {
      type: 'SYSTEM_ALERT',
      severity: '{{severity}}',
      action: 'VIEW_ALERT',
    },
  },

  socket: {
    event: 'SYSTEM_ALERT',
    data: {
      type: 'SYSTEM_ALERT',
      title: '{{alertTitle}}',
      message: '{{alertMessage}}',
      severity: '{{severity}}',
    },
  },

  database: {
    type: 'SYSTEM',
    title: '{{alertTitle}}',
    text: '{{alertMessage}}',
  },
};

export default systemAlert;
