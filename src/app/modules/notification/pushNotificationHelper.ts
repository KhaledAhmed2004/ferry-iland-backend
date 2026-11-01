import { logger } from '../../../shared/logger';
import config from '../../../config';
import admin from 'firebase-admin';

let isFirebaseInitialized = false;

const initFirebase = (): boolean => {
  if (isFirebaseInitialized || admin.apps.length > 0) {
    isFirebaseInitialized = true;
    return true;
  }

  if (!config.firebase_api_key_base64) {
    logger.warn(
      'Firebase Admin SDK skipped: FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 is not configured.',
    );
    return false;
  }

  try {
    const serviceAccountJson = Buffer.from(
      config.firebase_api_key_base64,
      'base64',
    ).toString('utf8');

    const serviceAccount: admin.ServiceAccount = JSON.parse(serviceAccountJson);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    isFirebaseInitialized = true;
    logger.info('Firebase Admin SDK initialized successfully.');
    return true;
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin SDK:', error);
    return false;
  }
};

const sendPushNotifications = async (
  values: admin.messaging.MulticastMessage,
) => {
  if (!initFirebase()) {
    logger.warn('Push notification skipped: Firebase not initialized.');
    return;
  }

  try {
    const res = await admin.messaging().sendEachForMulticast(values);
    logger.info('Notifications sent successfully', res);
    return res;
  } catch (error) {
    logger.error('Failed to send multicast push notifications:', error);
    throw error;
  }
};

const sendPushNotification = async (values: admin.messaging.Message) => {
  if (!initFirebase()) {
    logger.warn('Push notification skipped: Firebase not initialized.');
    return;
  }

  try {
    const res = await admin.messaging().send(values);
    logger.info('Notification sent successfully', res);
    return res;
  } catch (error) {
    logger.error('Failed to send single push notification:', error);
    throw error;
  }
};

export const pushNotificationHelper = {
  sendPushNotifications,
  sendPushNotification,
};
