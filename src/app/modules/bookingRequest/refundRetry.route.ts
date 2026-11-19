import express, { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { USER_ROLES } from '../../../enums/user';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { IAuthUser } from '../auth/auth.interface';
import { RefundRetryService } from './refundRetry.service';

const router = express.Router();

const retryRefundZodSchema = z.object({
  params: z.object({ refundId: z.string().uuid('Refund id must be a valid UUID') }),
});

// Spec 0004, AC-21: admins only.
router.post(
  '/:refundId/retry',
  auth(USER_ROLES.ADMIN),
  validateRequest(retryRefundZodSchema),
  catchAsync(async (req: Request, res: Response) => {
    const user = req.user as IAuthUser;
    const result = await RefundRetryService.retryRefund(req.params.refundId, user.id);

    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      success: true,
      message:
        result.status === 'FAILED'
          ? 'Stripe rejected the refund again'
          : 'Refund sent again',
      data: result,
    });
  }),
);

export const RefundRetryRoutes = router;
