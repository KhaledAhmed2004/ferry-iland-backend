import { JwtPayload } from 'jsonwebtoken';

export type IVerifyOtp = {
  email: string;
  oneTimeCode: number;
};

export type ILoginData = {
  email: string;
  password: string;
};

export type IAuthResetPassword = {
  newPassword: string;
  confirmPassword: string;
};

export type IChangePassword = {
  currentPassword?: string;
  newPassword: string;
  confirmPassword: string;
};

// Strongly typed user object for req.user
export type IAuthUser = {
  id: string; // From token payload
  email: string;
  role: string;
  // Add other fields you encode in your JWT here
} & JwtPayload
