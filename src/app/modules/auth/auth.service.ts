import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { StatusCodes } from 'http-status-codes';
import { JwtPayload, Secret } from 'jsonwebtoken';
import config from '../../../config';
import ApiError from '../../../errors/ApiError';
import { jwtHelper } from '../../../helpers/jwtHelper';
import { prisma } from '../../../shared/prisma';
import { ACCOUNT_STATE, USER_ROLES } from '../../../enums/user';
import { Role, AccountStatus, TokenType } from '@prisma/client';
import { SessionService, RevocationReason } from '../session/session.service';
import {
  ILoginReq,
  IRegisterUserReq,
  IResetPasswordReq,
  IVerifyOtpReq,
} from './auth.validation';
import { JwtUser } from '../../../types';
import { EmailService } from '../../../helpers/email';

const generateNumericOtp = (length: number = 6): string => {
  return Array.from({ length }, () => crypto.randomInt(0, 10)).join('');
};

const generateSecureToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

const assertAccountActive = (
  user: { deletedAt?: Date | null; status: AccountStatus; isEmailVerified?: boolean },
  requireEmailVerified = false,
) => {
  if (user.deletedAt) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Account has been deleted');
  }
  if (requireEmailVerified && user.status === AccountStatus.UNVERIFIED && !user.isEmailVerified) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Please verify your email to login');
  }
  if (user.status === AccountStatus.SUSPENDED) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Your account has been suspended. Please contact support.',
    );
  }
  if (user.status === AccountStatus.DEACTIVATED) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Your account has been deactivated. Please contact support.',
    );
  }
};

const createVerificationToken = async (
  userId: string,
  type: TokenType,
  durationMinutes = 15,
): Promise<string> => {
  await prisma.verificationToken.deleteMany({
    where: { userId, type },
  });

  const rawToken =
    type === TokenType.EMAIL_VERIFICATION ? generateNumericOtp(6) : generateSecureToken();
  const tokenHash = await bcrypt.hash(rawToken, 10);
  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

  await prisma.verificationToken.create({
    data: {
      userId,
      tokenHash,
      type,
      expiresAt,
    },
  });

  return rawToken;
};

const sendAuthEmail = async (
  to: string,
  name: string | null,
  type: TokenType,
  token: string,
) => {
  const isEmailVerification = type === TokenType.EMAIL_VERIFICATION;
  const subject = isEmailVerification ? 'Verify Your Email' : 'Password Reset Request';
  const body = isEmailVerification
    ? `<p>Your email verification OTP code is:</p>
       <h1 style="color: #2563eb; letter-spacing: 4px;">${token}</h1>
       <p>This code will expire in 15 minutes.</p>`
    : `<p>You requested to reset your password. Use the following token to reset it:</p>
       <p style="background: #f3f4f6; padding: 10px; font-family: monospace;">${token}</p>
       <p>This link/token will expire in 15 minutes.</p>`;

  try {
    await EmailService.sendEmail({
      to,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>${subject}</h2>
          <p>Hi ${name || 'there'},</p>
          ${body}
        </div>
      `,
    });
  } catch (err) {
    console.error(`Failed to send ${type} email:`, err);
  }
};

const generateAccessToken = (
  user: { id: string; email: string; role: Role | string; status: AccountStatus | string },
  sessionId: string,
  expiresIn = '7d',
): string => {
  return jwtHelper.createToken(
    {
      id: user.id,
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      accountState:
        user.status === AccountStatus.ACTIVE ? ACCOUNT_STATE.VERIFIED : (user.status as unknown as ACCOUNT_STATE),
      sessionId,
    },
    config.jwt.jwt_secret as Secret,
    expiresIn,
  );
};

const handleFailedLoginAttempt = async (user: { id: string; failedLoginAttempts?: number | null }) => {
  const failedAttempts = (user.failedLoginAttempts || 0) + 1;

  if (failedAttempts >= 5) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        status: AccountStatus.LOCKED,
        failedLoginAttempts: failedAttempts,
        lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Too many failed attempts. Your account has been locked for 15 minutes.',
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: failedAttempts },
  });
  throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials');
};

const registerUser = async (payload: IRegisterUserReq) => {
  const email = payload.email.toLowerCase().trim();
  const phoneNumber = payload.phoneNumber || payload.phone || null;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'Email already in use');
  }

  const hashedPassword = await bcrypt.hash(
    payload.password,
    Number(config.bcrypt_salt_rounds) || 12,
  );

  const isOperator =
    payload.role === Role.OPERATOR || payload.role === (USER_ROLES.OPERATOR as string);
  const role: Role = isOperator ? Role.OPERATOR : Role.USER;

  const displayName =
    payload.name?.trim() ||
    payload.contactPersonName?.trim() ||
    payload.companyName?.trim() ||
    payload.businessName?.trim() ||
    '';

  const user = await prisma.user.create({
    data: {
      name: displayName,
      email,
      phoneNumber,
      passwordHash: hashedPassword,
      role,
      status: AccountStatus.UNVERIFIED,
      isEmailVerified: false,
      ...(isOperator && (payload.companyName || payload.contactPersonName)
        ? {
            operatorProfile: {
              create: {
                companyName: (payload.companyName || payload.businessName || displayName).trim(),
                contactPersonName: (payload.contactPersonName || displayName).trim(),
              },
            },
          }
        : {}),
    },
    include: { operatorProfile: true },
  });

  const otp = await createVerificationToken(user.id, TokenType.EMAIL_VERIFICATION);
  await sendAuthEmail(user.email, user.name, TokenType.EMAIL_VERIFICATION, otp);

  return {
    userId: user.id,
    accountState: ACCOUNT_STATE.UNVERIFIED,
    status: user.status,
    message: 'Registration successful. Please check your email for the verification OTP.',
  };
};

const verifyEmail = async (payload: IVerifyOtpReq) => {
  const email = payload.email.toLowerCase().trim();
  const otpCode = String(payload.otp ?? payload.oneTimeCode ?? '').trim();

  const user = await prisma.user.findUnique({
    where: { email },
    include: { operatorProfile: true },
  });

  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid email or OTP');
  }

  assertAccountActive(user);

  if (user.status !== AccountStatus.UNVERIFIED && user.isEmailVerified) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Email is already verified');
  }

  const tokenRecord = await prisma.verificationToken.findFirst({
    where: { userId: user.id, type: TokenType.EMAIL_VERIFICATION },
    orderBy: { createdAt: 'desc' },
  });

  if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'OTP has expired or is invalid');
  }

  const isOtpValid = await bcrypt.compare(otpCode, tokenRecord.tokenHash);
  if (!isOtpValid) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid email or OTP');
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      status: AccountStatus.ACTIVE,
      isEmailVerified: true,
    },
    include: { operatorProfile: true },
  });

  await prisma.verificationToken.delete({ where: { id: tokenRecord.id } });

  return {
    message: 'Email verified successfully. You can now log in.',
    data: {
      id: updatedUser.id,
      email: updatedUser.email,
      status: updatedUser.status,
      accountState: ACCOUNT_STATE.VERIFIED,
      isApproved: true,
    },
  };
};

const resendVerificationEmail = async (email: string) => {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user || user.deletedAt) {
    return {
      message: 'If this email is registered, a new OTP has been sent.',
      data: { cooldownSeconds: 60, expiresInSeconds: 900 },
    };
  }

  if (user.status !== AccountStatus.UNVERIFIED && user.isEmailVerified) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Email is already verified');
  }

  assertAccountActive(user);

  const otp = await createVerificationToken(user.id, TokenType.EMAIL_VERIFICATION);
  await sendAuthEmail(user.email, user.name, TokenType.EMAIL_VERIFICATION, otp);

  return {
    message: 'If this email is registered, a new OTP has been sent.',
    data: { cooldownSeconds: 60, expiresInSeconds: 900 },
  };
};

const loginUser = async (
  payload: ILoginReq,
  clientIp?: string,
  deviceInfo?: string,
) => {
  const email = payload.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email },
    include: { operatorProfile: true },
  });

  if (!user || !user.passwordHash) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials');
  }

  assertAccountActive(user, true);

  const isLocked = user.status === AccountStatus.LOCKED;
  const isTemporarilyLocked = user.lockedUntil && user.lockedUntil > new Date();

  if (isTemporarilyLocked || (isLocked && !user.lockedUntil)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Your account is locked. Please try again later.',
    );
  }

  const isPasswordValid = await bcrypt.compare(payload.password, user.passwordHash);
  if (!isPasswordValid) {
    await handleFailedLoginAttempt(user);
  }

  if (user.failedLoginAttempts > 0 || user.status === AccountStatus.LOCKED || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        status: AccountStatus.ACTIVE,
      },
    });
  }

  const { session, plainRefreshToken } = await SessionService.createSession(
    user.id,
    deviceInfo,
    clientIp,
  );

  const accessToken = generateAccessToken(user, session.id, config.jwt.jwt_expire_in || '7d');

  return {
    tokens: {
      accessToken,
      refreshToken: plainRefreshToken,
    },
    sessionId: session.id,
    isApproved: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phoneNumber: user.phoneNumber,
      phone: user.phoneNumber,
      status: user.status,
      accountState: user.status === AccountStatus.ACTIVE ? ACCOUNT_STATE.VERIFIED : user.status,
      ...(user.operatorProfile ? { operatorProfile: user.operatorProfile } : {}),
    },
  };
};

const refreshToken = async (
  tokenOrSessionId: string,
  refreshTokenStr?: string,
  clientIp?: string,
  deviceInfo?: string,
) => {
  let sessionId = tokenOrSessionId;
  let token = refreshTokenStr || '';

  if (!token && tokenOrSessionId) {
    try {
      const decoded = jwtHelper.verifyToken(
        tokenOrSessionId,
        config.jwt.jwt_refresh_secret as Secret,
      ) as any;
      if (decoded?.sessionId) {
        sessionId = decoded.sessionId;
      }
      token = tokenOrSessionId;
    } catch {
      token = tokenOrSessionId;
    }
  }

  if (!token) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Refresh token is required');
  }

  const { session, newPlainRefreshToken } = await SessionService.refreshSession(
    sessionId,
    token,
    clientIp,
    deviceInfo,
  );

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { operatorProfile: true },
  });

  if (!user || user.deletedAt || user.status !== AccountStatus.ACTIVE) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User is no longer active');
  }

  const accessToken = generateAccessToken(user, session.id, config.jwt.jwt_expire_in || '15m');

  return {
    tokens: {
      accessToken,
      refreshToken: newPlainRefreshToken,
    },
    sessionId: session.id,
  };
};

const logoutUser = async (
  user: JwtUser | JwtPayload,
  sessionId?: string,
  _deviceToken?: string,
) => {
  const currentSessionId = sessionId || (user as any).sessionId;
  if (currentSessionId) {
    await prisma.session.updateMany({
      where: { id: currentSessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: RevocationReason.USER_LOGOUT },
    });
  }

  return { message: 'User logged out successfully.' };
};

const forgotPassword = async (email: string) => {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user || user.deletedAt) {
    return {
      message: 'If an account with this email exists, a password reset link has been sent.',
    };
  }

  const resetToken = await createVerificationToken(user.id, TokenType.PASSWORD_RESET);
  await sendAuthEmail(user.email, user.name, TokenType.PASSWORD_RESET, resetToken);

  return {
    message: 'If an account with this email exists, a password reset link has been sent.',
  };
};

const resetPassword = async (rawToken: string, payload: IResetPasswordReq) => {
  const token = (payload.token || rawToken || '').replace(/^Bearer\s+/i, '').trim();
  const email = payload.email?.toLowerCase().trim();

  let user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  let tokenRecord = null;

  if (user) {
    tokenRecord = await prisma.verificationToken.findFirst({
      where: { userId: user.id, type: TokenType.PASSWORD_RESET },
      orderBy: { createdAt: 'desc' },
    });
  } else {
    const recentTokens = await prisma.verificationToken.findMany({
      where: { type: TokenType.PASSWORD_RESET, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    for (const recentToken of recentTokens) {
      if (await bcrypt.compare(token, recentToken.tokenHash)) {
        tokenRecord = recentToken;
        user = await prisma.user.findUnique({ where: { id: recentToken.userId } });
        break;
      }
    }
  }

  if (!user || !tokenRecord || tokenRecord.expiresAt < new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Token has expired or is invalid');
  }

  const isTokenValid = await bcrypt.compare(token, tokenRecord.tokenHash);
  if (!isTokenValid) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid email or token');
  }

  const newPasswordHash = await bcrypt.hash(
    payload.newPassword,
    Number(config.bcrypt_salt_rounds) || 12,
  );

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newPasswordHash,
      lockedUntil: null,
      failedLoginAttempts: 0,
      status: AccountStatus.ACTIVE,
    },
  });

  await prisma.verificationToken.delete({ where: { id: tokenRecord.id } });
  await SessionService.revokeAllUserSessions(user.id, RevocationReason.PASSWORD_RESET);

  return {
    message: 'Password has been reset successfully. You can now log in.',
  };
};

export const AuthService = {
  registerUser,
  verifyEmail,
  resendVerificationEmail,
  loginUser,
  refreshToken,
  logoutUser,
  forgotPassword,
  resetPassword,
};
