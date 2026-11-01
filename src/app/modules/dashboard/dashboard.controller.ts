import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { DashboardService } from './dashboard.service';

const getDashboardStats = catchAsync(async (_req: Request, res: Response) => {
  const result = await DashboardService.getDashboardDashboardStats();
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Dashboard dashboard stats',
    data: result,
  });
});

const getMonthlyTrends = catchAsync(async (req: Request, res: Response) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const range = req.query.range as string | undefined;
  const metric = req.query.metric as string | undefined;

  const result = await DashboardService.getMonthlyTrends({ year, range, metric });
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Monthly trends retrieved successfully',
    data: result,
  });
});

const getRecentActivities = catchAsync(async (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 5;
  const result = await DashboardService.getRecentActivities(limit);
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Recent activities retrieved successfully',
    data: result,
  });
});

const getTopPerformers = catchAsync(async (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 5;
  const role = req.query.role as string | undefined;
  const result = await DashboardService.getTopPerformers(limit, role);
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Top performers retrieved successfully',
    data: result,
  });
});

const getOperatorOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await DashboardService.getOperatorOverview(req.user.id);
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Operator overview retrieved successfully',
    data: result,
  });
});

const getAdminAnalyticsOverview = catchAsync(
  async (req: Request, res: Response) => {
    const periodParam =
      (req.query.period as string) ||
      (req.query.days as string) ||
      '30d';
    const result = await DashboardService.getAdminAnalyticsOverview(periodParam);
    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Admin analytics overview retrieved successfully',
      data: result,
    });
  },
);

export const DashboardController = {
  getDashboardStats,
  getMonthlyTrends,
  getRecentActivities,
  getTopPerformers,
  getOperatorOverview,
  getAdminAnalyticsOverview,
};
