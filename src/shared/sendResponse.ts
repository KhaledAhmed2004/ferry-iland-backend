import { Response } from 'express';

type IData<T> = {
  success: boolean;
  statusCode: number;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    totalPage: number;
    total: number;
  };
  cursor?: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
  };
  data?: T;
};

const sendResponse = <T>(res: Response, data: IData<T>) => {
  // 👇 store full response data for logger middleware
  res.locals.responsePayload = data;

  const resData = {
    success: data.success,
    message: data.message,
    ...(data.pagination !== undefined && { pagination: data.pagination }),
    ...(data.cursor !== undefined && { cursor: data.cursor }),
    data: data.data,
  };

  res.status(data.statusCode).json(resData);
};

export default sendResponse;
