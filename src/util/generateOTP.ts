import crypto from 'crypto';

const generateOTP = (): number => {
  return crypto.randomInt(100000, 999999);
};

export default generateOTP;
