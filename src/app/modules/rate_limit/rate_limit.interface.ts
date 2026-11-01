import { Model } from 'mongoose';

export type IRateLimit = {
  key: string;
  points: number;
  expireAt: Date;
};

export type RateLimitModel = Model<IRateLimit>;
