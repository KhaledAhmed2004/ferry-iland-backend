/**
 * Chauffeur Applied Notification Template
 */

import { INotificationTemplate } from '../notification.types';

export const chauffeurApplied: INotificationTemplate = {
  name: 'chauffeurApplied',

  push: {
    title: 'New Chauffeur Application',
    body: '{{chauffeurName}}{{driverName}} applied for ride: {{jobTitle}}',
    data: {
      type: 'CHAUFFEUR_APPLIED',
      jobId: '{{jobId}}',
      chauffeurId: '{{chauffeurId}}{{driverId}}',
      action: 'VIEW_JOB_APPLICATIONS',
    },
  },

  socket: {
    event: 'CHAUFFEUR_APPLIED',
    data: {
      type: 'CHAUFFEUR_APPLIED',
      jobId: '{{jobId}}',
      chauffeurId: '{{chauffeurId}}{{driverId}}',
      chauffeurName: '{{chauffeurName}}{{driverName}}',
    },
  },

  database: {
    type: 'TASK',
    title: 'New Chauffeur Application',
    text: '{{chauffeurName}}{{driverName}} applied for ride: {{jobTitle}}',
  },
};

export const driverApplied: INotificationTemplate = {
  ...chauffeurApplied,
  name: 'driverApplied',
};

export default chauffeurApplied;
