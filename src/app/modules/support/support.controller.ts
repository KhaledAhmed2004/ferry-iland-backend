import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { SupportService } from './support.service';
import { JwtPayload } from 'jsonwebtoken';

export const SupportController = {
  createSupport: catchAsync(async (req: Request, res: Response) => {
    const user = req.user as JwtPayload;
    const result = await SupportService.createSupport(user.id, req.body);

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.CREATED,
      message: 'Support ticket created successfully',
      data: result,
    });
  }),

  getAllSupports: catchAsync(async (req: Request, res: Response) => {
    const result = await SupportService.getAllSupports(req.query);

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Support tickets retrieved successfully',
      pagination: result.pagination,
      data: result.data,
    });
  }),

  getMyTickets: catchAsync(async (req: Request, res: Response) => {
    const user = req.user as JwtPayload;
    const result = await SupportService.getMyTickets(user.id, req.query);

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'My support tickets retrieved successfully',
      pagination: result.pagination,
      data: result.data,
    });
  }),

  getSupportById: catchAsync(async (req: Request, res: Response) => {
    const result = await SupportService.getSupportById(req.params.id);

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Support ticket retrieved successfully',
      data: result,
    });
  }),

  addMessage: catchAsync(async (req: Request, res: Response) => {
    const user = req.user as JwtPayload;
    const result = await SupportService.addMessage(
      req.params.id,
      user.id,
      req.body.message,
    );

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Message sent successfully',
      data: result,
    });
  }),

  deleteSupport: catchAsync(async (req: Request, res: Response) => {
    const result = await SupportService.deleteSupport(req.params.id);

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Support ticket deleted successfully',
      data: result,
    });
  }),
};
