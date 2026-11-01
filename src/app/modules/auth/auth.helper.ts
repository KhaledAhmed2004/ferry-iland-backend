import { Secret } from 'jsonwebtoken';
import config from '../../../config';
import { jwtHelper } from '../../../helpers/jwtHelper';

export const computeUserAccessState = (user?: any) => ({
  isApproved: user?.accountState === 'VERIFIED' || user?.isEmailVerified === true,
  isOnboard: true,
});

export const generateUserTokens = (user: {
  id?: string;
  _id?: any;
  email: string;
  role: string;
  accountState?: string;
  sessionId?: string;
}) => {
  const userId = String(user.id || user._id);

  const accessToken = jwtHelper.createToken(
    {
      id: userId,
      sub: userId,
      email: user.email,
      role: user.role,
      accountState: user.accountState,
      sessionId: user.sessionId,
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in || '15m',
  );

  const refreshToken = jwtHelper.createToken(
    {
      id: userId,
      sub: userId,
      email: user.email,
      role: user.role,
      sessionId: user.sessionId,
    },
    config.jwt.jwt_refresh_secret as Secret,
    config.jwt.jwt_refresh_expire_in || '7d',
  );

  return { accessToken, refreshToken };
};
