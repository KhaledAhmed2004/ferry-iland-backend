import { NextFunction, Request, RequestHandler, Response } from 'express';

const catchAsync =
  (fn: RequestHandler) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      // In Express, next(null) or next(undefined) signals "no error" and skips error middleware.
      // Wrap nullish thrown values so they reliably reach globalErrorHandler.
      next(error ?? new Error('Unhandled null or undefined rejection'));
    }
  };

export default catchAsync;

