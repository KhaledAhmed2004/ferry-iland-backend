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
  IChangePasswordReq,
  IClaimAdminReq,
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

const registerUser = async (payload: IRegisterUserReq) => {
  const email = payload.email.toLowerCase().trim();
  const phone = payload.phoneNumber || payload.phone || null;

  // 1. Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'Email already in use');
  }

  // 2. Hash password
  const hashedPassword = await bcrypt.hash(
    payload.password,
    Number(config.bcrypt_salt_rounds) || 12,
  );

  const isOperator =
    payload.role === Role.OPERATOR ||
    payload.role === (USER_ROLES.OPERATOR as string);
  const role: Role = isOperator ? Role.OPERATOR : Role.USER;

  const displayName =
    payload.name?.trim() ||
    payload.contactPersonName?.trim() ||
    payload.companyName?.trim() ||
    payload.businessName?.trim() ||
    '';

  // 3. Create user in database (Prisma PostgreSQL)
  const user = await prisma.user.create({
    data: {
      name: displayName,
      email,
      phoneNumber: phone,
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
    include: {
      operatorProfile: true,
    },
  });

  // 4. Generate 6-digit numeric OTP
  const otp = generateNumericOtp(6);
  const tokenHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // 5. Store verification token
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash,
      type: TokenType.EMAIL_VERIFICATION,
      expiresAt,
    },
  });

  // 6. Send verification email via EmailService
  try {
    await EmailService.sendEmail({
      to: user.email,
      subject: 'Verify Your Email',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Welcome to Ferry Booking System</h2>
          <p>Hi ${user.name || 'there'},</p>
          <p>Your email verification OTP code is:</p>
          <h1 style="color: #2563eb; letter-spacing: 4px;">${otp}</h1>
          <p>This code will expire in 15 minutes.</p>
        </div>
      `,
    });
  } catch (err) {
    // If sending fails, log and continue so user creation doesn't fail
    console.error('Failed to send verification email:', err);
  }

  return {
    userId: user.id,
    accountState: ACCOUNT_STATE.UNVERIFIED,
    status: user.status,
    message:
      'Registration successful. Please check your email for the verification OTP.',
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

  if (user.deletedAt) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Account has been deleted');
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

  if (user.status !== AccountStatus.UNVERIFIED && user.isEmailVerified) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Email is already verified');
  }

  const tokenRecord = await prisma.verificationToken.findFirst({
    where: {
      userId: user.id,
      type: TokenType.EMAIL_VERIFICATION,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'OTP has expired or is invalid');
  }

  const isValid = await bcrypt.compare(otpCode, tokenRecord.tokenHash);
  if (!isValid) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid email or OTP');
  }

  // Update user as verified and active
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      status: AccountStatus.ACTIVE,
      isEmailVerified: true,
    },
    include: {
      operatorProfile: true,
    },
  });

  // Delete used token
  await prisma.verificationToken.delete({
    where: { id: tokenRecord.id },
  });

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
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  // Generic response to prevent email enumeration
  if (!user || user.deletedAt) {
    return {
      message: 'If this email is registered, a new OTP has been sent.',
    };
  }

  if (user.status !== AccountStatus.UNVERIFIED && user.isEmailVerified) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Email is already verified');
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

  // Delete existing unused email tokens
  await prisma.verificationToken.deleteMany({
    where: {
      userId: user.id,
      type: TokenType.EMAIL_VERIFICATION,
    },
  });

  // Generate new OTP
  const otp = generateNumericOtp(6);
  const tokenHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash,
      type: TokenType.EMAIL_VERIFICATION,
      expiresAt,
    },
  });

  try {
    await EmailService.sendEmail({
      to: user.email,
      subject: 'Verify Your Email',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Email Verification OTP</h2>
          <p>Hi ${user.name || 'there'},</p>
          <p>Your new verification OTP code is:</p>
          <h1 style="color: #2563eb; letter-spacing: 4px;">${otp}</h1>
          <p>This code will expire in 15 minutes.</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Failed to send resend email:', err);
  }

  return { message: 'If this email is registered, a new OTP has been sent.' };
};

const loginUser = async (
  payload: ILoginReq,
  ipAddress?: string,
  deviceInfo?: string,
) => {
  const email = payload.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      operatorProfile: true,
    },
  });

  if (!user || !user.passwordHash) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials');
  }

  if (user.deletedAt) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Account has been deleted');
  }

  if (user.status === AccountStatus.UNVERIFIED && !user.isEmailVerified) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Please verify your email to login');
  }

  if (user.status === AccountStatus.SUSPENDED) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Your account has been suspended');
  }

  if (user.status === AccountStatus.DEACTIVATED) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Your account is deactivated');
  }

  // Check temporary or hard lockout
  const isLocked = user.status === AccountStatus.LOCKED;
  const isTempLocked = user.lockedUntil && user.lockedUntil > new Date();

  if (isTempLocked || (isLocked && !user.lockedUntil)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Your account is locked. Please try again later.',
    );
  }

  const isPasswordValid = await bcrypt.compare(payload.password, user.passwordHash);

  if (!isPasswordValid) {
    const attempts = (user.failedLoginAttempts || 0) + 1;

    if (attempts >= 5) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          status: AccountStatus.LOCKED,
          failedLoginAttempts: attempts,
          lockedUntil: new Date(Date.now() + 15 * 60 * 1000), // 15 mins
        },
      });
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        'Too many failed attempts. Your account has been locked for 15 minutes.',
      );
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
        },
      });
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials');
    }
  }

  // Password is valid - reset failed attempts
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

  // Create database session with refresh token
  const { session, plainRefreshToken } = await SessionService.createSession(
    user.id,
    deviceInfo,
    ipAddress,
  );

  // Generate JWT access token
  const accessToken = jwtHelper.createToken(
    {
      id: user.id,
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      accountState: user.status === AccountStatus.ACTIVE ? ACCOUNT_STATE.VERIFIED : (user.status as unknown as ACCOUNT_STATE),
      sessionId: session.id,
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in || '7d',
  );

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
  ipAddress?: string,
  deviceInfo?: string,
) => {
  let sessionId = tokenOrSessionId;
  let token = refreshTokenStr || '';

  // If only one token is provided, determine if it's a JWT or direct refresh token
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
    ipAddress,
    deviceInfo,
  );

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { operatorProfile: true },
  });

  if (!user || user.deletedAt || user.status !== AccountStatus.ACTIVE) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User is no longer active');
  }

  const accessToken = jwtHelper.createToken(
    {
      id: user.id,
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      accountState: ACCOUNT_STATE.VERIFIED,
      sessionId: session.id,
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in || '15m',
  );

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
    // Scoped to the caller: a sessionId from the body must not log out another user.
    await prisma.session.updateMany({
      where: { id: currentSessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: RevocationReason.USER_LOGOUT },
    });
  }

  return { message: 'User logged out successfully.' };
};

const logoutAll = async (userId: string) => {
  await SessionService.revokeAllUserSessions(userId, RevocationReason.USER_LOGOUT_ALL);
  return { message: 'Logged out from all devices' };
};

const forgotPassword = async (email: string) => {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user || user.deletedAt) {
    return {
      message:
        'If an account with this email exists, a password reset link has been sent.',
    };
  }

  // Delete existing unused password tokens
  await prisma.verificationToken.deleteMany({
    where: { userId: user.id, type: TokenType.PASSWORD_RESET },
  });

  const resetToken = generateSecureToken();
  const tokenHash = await bcrypt.hash(resetToken, 10);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash,
      type: TokenType.PASSWORD_RESET,
      expiresAt,
    },
  });

  try {
    await EmailService.sendEmail({
      to: user.email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Password Reset Request</h2>
          <p>Hi ${user.name || 'there'},</p>
          <p>You requested to reset your password. Use the following token to reset it:</p>
          <p style="background: #f3f4f6; padding: 10px; font-family: monospace;">${resetToken}</p>
          <p>This link/token will expire in 15 minutes.</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Failed to send reset password email:', err);
  }

  return {
    message:
      'If an account with this email exists, a password reset link has been sent.',
  };
};

const resetPassword = async (rawToken: string, payload: IResetPasswordReq) => {
  const token = (payload.token || rawToken || '').replace(/^Bearer\s+/i, '').trim();
  const email = payload.email?.toLowerCase().trim();

  let user = email ? await prisma.user.findUnique({ where: { email } }) : null;

  let tokenRecord = null;
  if (user) {
    tokenRecord = await prisma.verificationToken.findFirst({
      where: {
        userId: user.id,
        type: TokenType.PASSWORD_RESET,
      },
      orderBy: { createdAt: 'desc' },
    });
  } else {
    // If email wasn't provided, search recent tokens
    const recentTokens = await prisma.verificationToken.findMany({
      where: {
        type: TokenType.PASSWORD_RESET,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    for (const t of recentTokens) {
      if (await bcrypt.compare(token, t.tokenHash)) {
        tokenRecord = t;
        user = await prisma.user.findUnique({ where: { id: t.userId } });
        break;
      }
    }
  }

  if (!user || !tokenRecord || tokenRecord.expiresAt < new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Token has expired or is invalid');
  }

  const isValid = await bcrypt.compare(token, tokenRecord.tokenHash);
  if (!isValid) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid email or token');
  }

  const newPasswordHash = await bcrypt.hash(
    payload.newPassword,
    Number(config.bcrypt_salt_rounds) || 12,
  );

  // Update password and clear lockout
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newPasswordHash,
      lockedUntil: null,
      failedLoginAttempts: 0,
      status: AccountStatus.ACTIVE,
    },
  });

  // Delete used token
  await prisma.verificationToken.delete({
    where: { id: tokenRecord.id },
  });

  // Revoke all existing sessions
  await SessionService.revokeAllUserSessions(user.id, RevocationReason.PASSWORD_RESET);

  return {
    message: 'Password has been reset successfully. You can now log in.',
  };
};

const changePassword = async (
  user: JwtPayload | JwtUser,
  payload: IChangePasswordReq,
) => {
  const currentPassword = payload.currentPassword || payload.oldPassword;
  if (!currentPassword) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Current password is required');
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: user.id },
  });

  if (!existingUser || !existingUser.passwordHash) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  const isMatch = await bcrypt.compare(currentPassword, existingUser.passwordHash);
  if (!isMatch) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Incorrect old password');
  }

  if (currentPassword === payload.newPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'New password must be different from current password',
    );
  }

  const hashPassword = await bcrypt.hash(
    payload.newPassword,
    Number(config.bcrypt_salt_rounds) || 12,
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword },
  });

  // Revoke all other sessions after a password change to ensure security
  await SessionService.revokeAllUserSessions(user.id, RevocationReason.PASSWORD_CHANGED);

  return {
    message:
      'Password updated successfully. All devices have been logged out. Please log in again.',
  };
};

const claimAdmin = async (user: JwtUser, payload: IClaimAdminReq) => {
  const { email, currentPassword, newPassword } = payload;
  const isExistUser = await prisma.user.findUnique({
    where: { id: user.id },
  });

  if (!isExistUser || !isExistUser.passwordHash) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Admin account not found');
  }

  if (isExistUser.role !== Role.ADMIN && !isExistUser.isRootAdmin) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Only admin accounts can perform initial setup',
    );
  }

  const isMatch = await bcrypt.compare(currentPassword, isExistUser.passwordHash);
  if (!isMatch) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Current password is incorrect');
  }

  const hashPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds) || 12,
  );

  const updatedAdmin = await prisma.user.update({
    where: { id: isExistUser.id },
    data: {
      email,
      passwordHash: hashPassword,
      status: AccountStatus.ACTIVE,
    },
  });

  const accessToken = jwtHelper.createToken(
    {
      id: updatedAdmin.id,
      sub: updatedAdmin.id,
      email: updatedAdmin.email,
      role: updatedAdmin.role,
      status: updatedAdmin.status,
      accountState: ACCOUNT_STATE.VERIFIED,
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in || '1d',
  );

  return {
    tokens: { accessToken, refreshToken: '' },
    user: {
      id: updatedAdmin.id,
      email: updatedAdmin.email,
    },
  };
};

const getMyStatus = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      operatorProfile: true,
    },
  });

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    accountState: user.status === AccountStatus.ACTIVE ? ACCOUNT_STATE.VERIFIED : user.status,
    isEmailVerified: user.isEmailVerified,
    phoneNumber: user.phoneNumber,
    phone: user.phoneNumber,
    companyName: user.operatorProfile?.companyName,
    contactPersonName: user.operatorProfile?.contactPersonName,
    operatorProfile: user.operatorProfile,
    isApproved: user.status === AccountStatus.ACTIVE || user.isEmailVerified,
  };
};

export const AuthService = {
  registerUser,
  verifyEmail,
  resendVerificationEmail,
  loginUser,
  refreshToken,
  logoutUser,
  logoutAll,
  forgotPassword,
  resetPassword,
  changePassword,
  claimAdmin,
  getMyStatus,
};
