import crypto from 'crypto';
import config from '../config';

/**
 * Hash an OTP using HMAC-SHA256
 */
export const hashOtp = (otp: string): string => {
  return crypto
    .createHmac('sha256', config.otp_secret as string)
    .update(otp)
    .digest('hex');
};

/**
 * Verify an OTP against a stored hash using constant-time comparison
 */
export const verifyOtpHash = (inputOtp: string, storedHash: string): boolean => {
  const inputHash = hashOtp(inputOtp);
  
  const inputBuffer = Buffer.from(inputHash, 'hex');
  const storedBuffer = Buffer.from(storedHash, 'hex');

  // To prevent timing attacks when length mismatches
  if (inputBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(inputBuffer, storedBuffer);
};

// AES encryption key derived from otp_secret
const ENCRYPTION_KEY = crypto.createHash('sha256').update(config.otp_secret as string).digest(); 
const IV_LENGTH = 16; 

/**
 * Encrypt arbitrary payload for secure storage (e.g., in Outbox)
 */
export const encryptPayload = (payload: any): string => {
  const text = JSON.stringify(payload);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
};

/**
 * Decrypt a payload back to an object
 */
export const decryptPayload = (encryptedText: string): any => {
  const textParts = encryptedText.split(':');
  const iv = Buffer.from(textParts.shift() as string, 'hex');
  const encrypted = textParts.join(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
};
