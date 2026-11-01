import { Schema, model } from 'mongoose';
import { IRateLimit, RateLimitModel } from './rate_limit.interface';

const rateLimitSchema = new Schema<IRateLimit>(
  {
    key: { type: String, required: true, unique: true },
    points: { type: Number, required: true },
    expireAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// TTL Index for automatic cleanup
rateLimitSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit = model<IRateLimit, RateLimitModel>(
  'RateLimit',
  rateLimitSchema,
);
