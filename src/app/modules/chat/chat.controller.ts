import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { JwtPayload } from 'jsonwebtoken';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { ChatService } from './chat.service';

const getOrCreate = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as JwtPayload).id;
  const { participantId, itemId, jobId, supportId } = req.body;

  const result = await ChatService.getOrCreateChat(userId, participantId, {
    itemId,
    jobId,
    supportId,
  });

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Chat retrieved successfully',
    data: result,
  });
});

const getMyChats = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as JwtPayload).id;
  const result = await ChatService.getMyChats(userId, req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Chats retrieved successfully',
    data: result,
  });
});

const getChatById = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as JwtPayload).id;
  const { chatId } = req.params;
  const result = await ChatService.getChatById(chatId, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Chat retrieved successfully',
    data: result,
  });
});

const deleteChat = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as JwtPayload).id;
  const { chatId } = req.params;
  const result = await ChatService.deleteChatFromDB(chatId, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Chat deleted successfully',
    data: result,
  });
});

export const ChatController = {
  getOrCreate,
  getMyChats,
  getChatById,
  deleteChat,
};
