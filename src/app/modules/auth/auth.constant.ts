export const OTP_COOLDOWN_MS = 60 * 1000;
export const OTP_EXPIRY_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const RESET_TOKEN_EXPIRY_MS = 15 * 60 * 1000;

export const calculateLockoutState = (attempts: number) => {
  if (attempts >= OTP_MAX_ATTEMPTS) {
    return { lockUntil: new Date(Date.now() + 15 * 60 * 1000), isLocked: true };
  }
  return { lockUntil: null, isLocked: false };
};
