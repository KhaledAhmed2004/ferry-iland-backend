/**
 * Task / Ride Completed Notification Template
 */

import { INotificationTemplate } from '../notification.types';

export const taskCompleted: INotificationTemplate = {
  name: 'taskCompleted',

  push: {
    title: 'Ride Completed',
    body: 'Your ride {{jobTitle}} was completed successfully.',
    data: {
      type: 'TASK_COMPLETED',
      jobId: '{{jobId}}',
      action: 'LEAVE_REVIEW',
    },
  },

  socket: {
    event: 'TASK_COMPLETED',
    data: {
      type: 'TASK_COMPLETED',
      jobId: '{{jobId}}',
      jobTitle: '{{jobTitle}}',
    },
  },

  database: {
    type: 'TASK',
    title: 'Ride Completed',
    text: 'Your ride {{jobTitle}} was completed successfully.',
  },
};

export default taskCompleted;
