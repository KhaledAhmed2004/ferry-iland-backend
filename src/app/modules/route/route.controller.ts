import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { RouteService } from './route.service';
import { IAuthUser } from '../auth/auth.interface';

const createRoute = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await RouteService.createRoute(user.id, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Route created successfully',
    data: result,
  });
});

const listRoutes = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await RouteService.listOperatorRoutes(user.id, req.query as any);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Routes retrieved successfully',
    data: result,
  });
});

const getRouteById = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await RouteService.getRouteById(user.id, req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Route retrieved successfully',
    data: result,
  });
});

const updateRoute = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await RouteService.updateRoute(user.id, req.params.id, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Route updated successfully',
    data: result,
  });
});

const deleteRoute = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const result = await RouteService.deleteRoute(user.id, req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

const bulkUpdateRouteStatus = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const { ids, status } = req.body;
  const result = await RouteService.bulkUpdateRouteStatus(user.id, ids, status);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

const bulkDeleteRoutes = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IAuthUser;
  const { ids } = req.body;
  const result = await RouteService.bulkDeleteRoutes(user.id, ids);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

const getConnectedPorts = catchAsync(async (_req: Request, res: Response) => {
  const result = await RouteService.getPublicConnectedPorts();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Connected ports retrieved successfully',
    data: result,
  });
});

const getPopularRoutes = catchAsync(async (req: Request, res: Response) => {
  const result = await RouteService.getPopularRoutes(req.query as any);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Popular routes retrieved successfully',
    data: result,
  });
});

export const RouteController = {
  createRoute,
  listRoutes,
  getRouteById,
  updateRoute,
  deleteRoute,
  bulkUpdateRouteStatus,
  bulkDeleteRoutes,
  getConnectedPorts,
  getPopularRoutes,
};

