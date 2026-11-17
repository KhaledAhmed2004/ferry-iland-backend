import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { AdminService } from './admin.service';
import { UpdateCommissionDTO } from './admin.validation';
import {
  IAdminPaymentsQuery,
  IAdminPayoutBookingsQuery,
  IAdminPayoutsQuery,
  IAdminRefundsQuery,
} from './admin.interface';
import { AdminPaymentsService } from './adminPayments.service';
import { csvFileName } from './adminPayments.csv';
import { payoutBookingsCsv, payoutsCsv, paymentsCsv, refundsCsv } from './adminPayments.export';

const getPlatformSettings = catchAsync(async (_req: Request, res: Response) => {
  const result = await AdminService.getPlatformSettings();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Platform settings retrieved successfully',
    data: result,
  });
});

const updateCommissionSettings = catchAsync(
  async (req: Request, res: Response) => {
    const payload: UpdateCommissionDTO = req.body;
    const result = await AdminService.updateCommissionSettings(payload);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: 'Platform commission settings updated successfully',
      data: result,
    });
  },
);

/** Spec 0006, AC-8: `format=csv` answers with the file instead of the JSON envelope. */
const sendCsv = (res: Response, fileName: string, csv: string) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.status(StatusCodes.OK).send(csv);
};

const ok = <T>(res: Response, message: string, data: T) =>
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message, data });

const getAdminPayments = catchAsync(async (req: Request, res: Response) => {
  const query = req.query as IAdminPaymentsQuery;
  if (query.format === 'csv') {
    const rows = await AdminPaymentsService.exportPayments(query);
    return sendCsv(res, csvFileName('payments', query.from, query.to), paymentsCsv(rows));
  }
  ok(res, 'Admin payments retrieved successfully', await AdminPaymentsService.listPayments(query));
});

const getAdminRefunds = catchAsync(async (req: Request, res: Response) => {
  const query = req.query as IAdminRefundsQuery;
  if (query.format === 'csv') {
    const rows = await AdminPaymentsService.exportRefunds(query);
    return sendCsv(res, csvFileName('refunds', query.from, query.to), refundsCsv(rows));
  }
  ok(res, 'Admin refunds retrieved successfully', await AdminPaymentsService.listRefunds(query));
});

const getAdminPayouts = catchAsync(async (req: Request, res: Response) => {
  const query = req.query as IAdminPayoutsQuery;
  const result = await AdminPaymentsService.listPayouts(query);
  if (query.format === 'csv') {
    return sendCsv(res, csvFileName('payouts', query.from, query.to), payoutsCsv(result.data));
  }
  ok(res, 'Operator payouts retrieved successfully', result);
});

const getAdminPayoutBookings = catchAsync(async (req: Request, res: Response) => {
  const query = req.query as IAdminPayoutBookingsQuery;
  const operatorId = req.params.operatorId as string;
  if (query.format === 'csv') {
    const result = await AdminPaymentsService.exportPayoutBookings(operatorId, query);
    return sendCsv(
      res,
      csvFileName(`payout-bookings-${result.operator.companyName.replace(/[^A-Za-z0-9]+/g, '_')}`, query.from, query.to),
      payoutBookingsCsv(result.rows),
    );
  }
  ok(
    res,
    'Operator payout bookings retrieved successfully',
    await AdminPaymentsService.listPayoutBookings(operatorId, query),
  );
});

export const AdminController = {
  getPlatformSettings,
  updateCommissionSettings,
  getAdminPayments,
  getAdminRefunds,
  getAdminPayouts,
  getAdminPayoutBookings,
};
