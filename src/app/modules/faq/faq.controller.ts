import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { FaqService } from './faq.service';

const createFaq = catchAsync(async (req: Request, res: Response) => {
  const result = await FaqService.createFaq(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'FAQ item created successfully',
    data: result,
  });
});

const listFaqs = catchAsync(async (req: Request, res: Response) => {
  const result = await FaqService.listFaqs(req.query as any);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'FAQs retrieved successfully',
    data: result,
  });
});

const getPublicFaqs = catchAsync(async (req: Request, res: Response) => {
  const result = await FaqService.getPublicFaqs(req.query as any);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Public FAQs retrieved successfully',
    data: result,
  });
});

const getFaqById = catchAsync(async (req: Request, res: Response) => {
  const result = await FaqService.getFaqById(req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'FAQ item retrieved successfully',
    data: result,
  });
});

const updateFaq = catchAsync(async (req: Request, res: Response) => {
  const result = await FaqService.updateFaq(req.params.id, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'FAQ item updated successfully',
    data: result,
  });
});

const deleteFaq = catchAsync(async (req: Request, res: Response) => {
  const result = await FaqService.deleteFaq(req.params.id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'FAQ item deleted successfully',
    data: result,
  });
});


const bulkUpdatePublish = catchAsync(async (req: Request, res: Response) => {
  const { ids, isPublished } = req.body;
  const result = await FaqService.bulkUpdatePublish(ids, isPublished);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `${result.count} FAQs status updated successfully`,
    data: result,
  });
});

const bulkUpdateCategory = catchAsync(async (req: Request, res: Response) => {
  const { ids, category } = req.body;
  const result = await FaqService.bulkUpdateCategory(ids, category);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `${result.count} FAQs category updated successfully`,
    data: result,
  });
});

const bulkDelete = catchAsync(async (req: Request, res: Response) => {
  const { ids } = req.body;
  const result = await FaqService.bulkDelete(ids);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `${result.count} FAQs deleted successfully`,
    data: result,
  });
});

export const FaqController = {
  createFaq,
  listFaqs,
  getPublicFaqs,
  getFaqById,
  updateFaq,
  deleteFaq,
  bulkUpdatePublish,
  bulkUpdateCategory,
  bulkDelete,
};
