import { JwtPayload } from 'jsonwebtoken';
import { Server as SocketIOServer } from 'socket.io';
import { Role, AccountStatus } from '@prisma/client';
import { ACCOUNT_STATE, USER_ROLES } from '../enums/user';

export type JwtUser = {
  id: string;
  email: string;
  role: Role | USER_ROLES | string;
  status?: AccountStatus | string;
  accountState?: ACCOUNT_STATE | string;
  sessionId?: string;
  serviceAreaId?: string;
} & JwtPayload;

declare global {
  var io: SocketIOServer | undefined;

  namespace Express {
    interface Request {
      user: JwtUser;
    }
  }
}
