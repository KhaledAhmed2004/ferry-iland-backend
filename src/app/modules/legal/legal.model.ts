import { model, Schema } from 'mongoose';
import { ILegalPage, LegalPageModel } from './legal.interface';

const legalPageSchema = new Schema<ILegalPage, LegalPageModel>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      default: '',
    },
  },
  { timestamps: true, versionKey: false },
);

// Unique Index on title with case-insensitive collation
legalPageSchema.index(
  { title: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);

export const LegalPage = model<ILegalPage, LegalPageModel>(
  'LegalPage',
  legalPageSchema,
);

