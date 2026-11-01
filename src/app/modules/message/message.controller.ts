import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { JwtPayload } from 'jsonwebtoken';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { MessageService } from './message.service';

const sendMessage = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as JwtPayload).id;
  const { chatId } = req.params;

  const result = await MessageService.sendMessage(chatId, userId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: 'Message sent successfully',
    data: result,
  });
});

const getMessages = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as JwtPayload).id;
  const { chatId } = req.params;

  const result = await MessageService.getMessages(chatId, userId, req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Messages retrieved successfully',
    cursor: result.cursor,
    data: result.data,
  });
});

export const MessageController = { sendMessage, getMessages };
