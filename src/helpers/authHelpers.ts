import { StatusCodes } from 'http-status-codes';
import ApiError from '../errors/ApiError';
import generateOTP from '../util/generateOTP';
import { emailHelper } from './emailHelper';
import { emailTemplate } from '../shared/emailTemplate';
import { prisma } from '../shared/prisma';
import { AccountStatus, TokenType } from '@prisma/client';

const OTP_EXPIRY_MINUTES = 3;

/**
 * Generates OTP, saves to verification token record, and sends verification email
 * @param email - User's email address
 * @returns Object containing the generated OTP (for logging/debugging)
 * @throws ApiError if user doesn't exist or is already verified
 */
export const sendVerificationOTP = async (email: string) => {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if (user.status === AccountStatus.ACTIVE || user.isEmailVerified) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User is already verified!');
  }

  const otp = generateOTP();

  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash: String(otp),
      type: TokenType.EMAIL_VERIFICATION,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000),
    },
  });

  const emailData = emailTemplate.createAccount({
    name: user.name,
    email: user.email,
    otp,
  });
  await emailHelper.sendEmail(emailData);

  return { otp };
};

