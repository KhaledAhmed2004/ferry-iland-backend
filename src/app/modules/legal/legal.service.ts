import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { ILegalPage } from './legal.interface';
import { LegalPage } from './legal.model';

const createLegalPage = async (
  payload: Partial<ILegalPage>,
): Promise<ILegalPage> => {
  const result = await LegalPage.create(payload);
  return result;
};

const getAll = async (): Promise<ILegalPage[]> => {
  const result = await LegalPage.find()
    .select('-content')
    .sort({ createdAt: -1 })
    .lean();
  return result;
};

const getById = async (legalId: string): Promise<ILegalPage> => {
  const result = await LegalPage.findById(legalId).lean();
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Legal page not found');
  }
  return result;
};

const updateById = async (
  legalId: string,
  payload: Partial<ILegalPage>,
): Promise<ILegalPage> => {
  const result = await LegalPage.findByIdAndUpdate(legalId, payload, {
    new: true,
    runValidators: true,
  }).lean();

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Legal page not found');
  }
  return result as ILegalPage;
};

const deleteById = async (legalId: string): Promise<void> => {
  const result = await LegalPage.findByIdAndDelete(legalId);
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Legal page not found');
  }
};

export const LegalService = {
  createLegalPage,
  getAll,
  getById,
  updateById,
  deleteById,
};
