import { JwtPayload } from 'jsonwebtoken';

export type IAuthUser = {
  id: string;
  email: string;
  role: string;
} & JwtPayload;
