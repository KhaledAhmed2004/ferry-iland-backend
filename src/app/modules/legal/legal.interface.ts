import { Model } from 'mongoose';

export type ILegalPage = {
  title: string;
  content?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type LegalPageModel = Model<ILegalPage>;
