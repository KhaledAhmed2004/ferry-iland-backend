/**
 * Ride Status Update Notification Template
 */

import { INotificationTemplate } from '../notification.types';

export const rideStatusUpdate: INotificationTemplate = {
  name: 'rideStatusUpdate',

  push: {
    title: 'Ride Status Updated',
    body: '{{driverName}} updated ride status to {{rideStatus}}',
    data: {
      type: 'RIDE_STATUS_UPDATE',
      jobId: '{{jobId}}',
      rideStatus: '{{rideStatus}}',
      action: 'VIEW_JOB',
    },
  },

  socket: {
    event: 'RIDE_STATUS_UPDATE',
    data: {
      type: 'RIDE_STATUS_UPDATE',
      jobId: '{{jobId}}',
      rideStatus: '{{rideStatus}}',
      driverName: '{{driverName}}',
    },
  },

  database: {
    type: 'TASK',
    title: 'Ride Status Updated',
    text: '{{driverName}} updated ride status to {{rideStatus}}',
  },
};

export default rideStatusUpdate;
