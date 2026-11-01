import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { PortService } from './port.service';

const createPort = catchAsync(async (req: Request, res: Response) => {
  const result = await PortService.createPort(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Port created successfully',
    data: result,
  });
});

const listPorts = catchAsync(async (req: Request, res: Response) => {
  const result = await PortService.listPorts(req.query as any);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Ports retrieved successfully',
    data: result,
  });
});

const getPortById = catchAsync(async (req: Request, res: Response) => {
  const result = await PortService.getPortById(req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Port retrieved successfully',
    data: result,
  });
});

const updatePort = catchAsync(async (req: Request, res: Response) => {
  const result = await PortService.updatePort(req.params.id, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Port updated successfully',
    data: result,
  });
});

const deletePort = catchAsync(async (req: Request, res: Response) => {
  const result = await PortService.deletePort(req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result.port,
  });
});

export const PortController = {
  createPort,
  listPorts,
  getPortById,
  updatePort,
  deletePort,
};
