/**
 * New Message Notification Template
 */

import { INotificationTemplate } from '../notification.types';

export const newMessage: INotificationTemplate = {
  name: 'newMessage',

  push: {
    title: 'New Message from {{senderName}}',
    body: '{{messagePreview}}',
    data: {
      type: 'NEW_MESSAGE',
      senderId: '{{senderId}}',
      chatId: '{{chatId}}',
      action: 'OPEN_CHAT',
    },
  },

  socket: {
    event: 'MESSAGE_NOTIFICATION',
    data: {
      type: 'NEW_MESSAGE',
      senderId: '{{senderId}}',
      senderName: '{{senderName}}',
      chatId: '{{chatId}}',
      message: '{{messagePreview}}',
    },
  },

  database: {
    type: 'MESSAGE',
    title: 'New Message from {{senderName}}',
    text: '{{messagePreview}}',
  },
};

export default newMessage;
