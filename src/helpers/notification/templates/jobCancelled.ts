/**
 * Job Cancelled Notification Template
 */

import { INotificationTemplate } from '../notification.types';

export const jobCancelled: INotificationTemplate = {
  name: 'jobCancelled',

  push: {
    title: 'Ride / Job Cancelled',
    body: '{{jobTitle}} has been cancelled. {{reason}}',
    data: {
      type: 'JOB_CANCELLED',
      jobId: '{{jobId}}',
      action: 'VIEW_JOB',
    },
  },

  socket: {
    event: 'JOB_CANCELLED',
    data: {
      type: 'JOB_CANCELLED',
      jobId: '{{jobId}}',
      reason: '{{reason}}',
    },
  },

  database: {
    type: 'TASK',
    title: 'Ride / Job Cancelled',
    text: '{{jobTitle}} has been cancelled. {{reason}}',
  },
};

export default jobCancelled;
