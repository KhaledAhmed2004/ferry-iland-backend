import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { IAuthUser } from '../auth/auth.interface';
import { IPaymentRequester } from './payment.interface';
import { PaymentService } from './payment.service';
import { handleStripeWebhook } from './payment.webhook';

const requesterFrom = (req: Request): IPaymentRequester => {
  const user = req.user as IAuthUser | undefined;
  return {
    userId: user?.id ?? null,
    role: user?.role ?? null,
    email: typeof req.body?.email === 'string' ? req.body.email : null,
  };
};

const createPaymentIntent = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentService.createOrGetIntent(req.body, requesterFrom(req));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Payment ready',
    data: result,
  });
});

const syncPayment = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentService.syncPayment(
    req.params.bookingId,
    requesterFrom(req),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Payment status synced',
    data: result,
  });
});

/**
 * Stripe webhook (spec 0002, AC-7 to AC-11). Answers Stripe directly, not through sendResponse:
 * Stripe reads only the status code (2xx done, anything else retried).
 */
const handleWebhook = async (req: Request, res: Response) => {
  const { status, body } = await handleStripeWebhook(req.body, req.headers['stripe-signature']);
  res.status(status).json(body);
};

export const PaymentController = {
  createPaymentIntent,
  syncPayment,
  handleWebhook,
};
