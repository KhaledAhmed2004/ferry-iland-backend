import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { NotificationService } from './notification.service';

const listMyNotifications = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const options = {
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    cursor: req.query.cursor as string | undefined,
  };
  const result = await NotificationService.getUserNotifications(userId, options);
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Notifications fetched',
    ...(result.type === 'cursor' && { cursor: result.cursor }),
    ...(result.type === 'offset' && { pagination: result.pagination }),
    data: result.data,
  });
});

const markAllRead = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await NotificationService.markAllRead(userId);
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'All notifications marked read',
    data: result,
  });
});

const markRead = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const notificationId = req.params.notificationId;
  const read = req.body?.read ?? true;
  const result = await NotificationService.markRead(
    notificationId,
    userId,
    read,
  );
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: read ? 'Notification marked read' : 'Notification marked unread',
    data: result,
  });
});

const deleteNotification = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const notificationId = req.params.notificationId;
  const result = await NotificationService.deleteNotification(notificationId, userId);
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Notification deleted',
    data: result,
  });
});

export const NotificationController = {
  listMyNotifications,
  markAllRead,
  markRead,
  deleteNotification,
};


