import { z } from 'zod';
import { USER_ROLES } from '../../../enums/user';

const phoneRegex = /^\+?[0-9]{7,15}$/;
const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-={}\[\]|;:'",.<>/?]).{8,}$/;

// Register Schema
const registerUserZodSchema = z.object({
  body: z
    .object({
      name: z.string().optional(),
      email: z
        .string({ error: 'Email is required' })
        .email('Invalid email address')
        .transform(val => val.toLowerCase().trim()),
      password: z
        .string({ error: 'Password is required' })
        .min(8, 'Password must be at least 8 characters long')
        .max(128, 'Password cannot exceed 128 characters')
        .regex(
          passwordRegex,
          'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
        ),
      phone: z.string().regex(phoneRegex, 'Invalid phone number format').optional(),
      phoneNumber: z.string().regex(phoneRegex, 'Invalid phone number format').optional(),
      role: z
        .enum([
          USER_ROLES.USER,
          USER_ROLES.OPERATOR,
          USER_ROLES.ADMIN,
          USER_ROLES.PROMOTER,
          USER_ROLES.BUSINESS_OWNER,
        ])
        .optional()
        .default(USER_ROLES.USER),
      companyName: z.string().optional(),
      contactPersonName: z.string().optional(),
      businessName: z.string().optional(),
      profilePicture: z.string().optional(),
    })
    .passthrough()
    .superRefine((data, ctx) => {
      const isOperator = data.role === USER_ROLES.OPERATOR;
      const isBusinessOwner = data.role === USER_ROLES.BUSINESS_OWNER;

      if (isBusinessOwner) {
        if (!data.businessName) {
          ctx.addIssue({
            code: 'custom',
            message: 'businessName is required for registration validation',
            path: ['businessName'],
          });
        }
      } else if (isOperator) {
        if (!data.companyName && !data.businessName) {
          ctx.addIssue({
            code: 'custom',
            message: 'companyName is required for operator registration',
            path: ['companyName'],
          });
        }
        if (!data.contactPersonName && !data.name) {
          ctx.addIssue({
            code: 'custom',
            message: 'contactPersonName is required for operator registration',
            path: ['contactPersonName'],
          });
        }
      } else {
        if (!data.name || !data.name.trim()) {
          ctx.addIssue({
            code: 'custom',
            message: 'name is required for user registration',
            path: ['name'],
          });
        }
      }

      if (!data.phone && !data.phoneNumber) {
        ctx.addIssue({
          code: 'custom',
          message: 'phoneNumber is required',
          path: ['phoneNumber'],
        });
      }
    }),
});

// Verify OTP / Email Schema
const verifyOtpSchema = z.object({
  body: z
    .object({
      email: z
        .string({ error: 'Email is required' })
        .email('Invalid email address')
        .transform(val => val.toLowerCase().trim()),
      otp: z.union([z.string(), z.number()]).optional(),
      oneTimeCode: z.union([z.string(), z.number()]).optional(),
    })
    .passthrough()
    .superRefine((data, ctx) => {
      const code = data.otp ?? data.oneTimeCode;
      if (code === undefined || String(code).trim().length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'OTP is required',
          path: ['otp'],
        });
      }
    }),
});

// Resend OTP Schema
const resendOtpSchema = z.object({
  body: z
    .object({
      email: z
        .string({ error: 'Email is required' })
        .email('Invalid email address')
        .transform(val => val.toLowerCase().trim()),
    })
    .passthrough(),
});

// Login Schema
const loginSchema = z.object({
  body: z
    .object({
      email: z
        .string({ error: 'Email is required' })
        .email('Invalid email address')
        .transform(val => val.toLowerCase().trim()),
      password: z
        .string({ error: 'Password is required' })
        .min(1, 'Password is required'),
      deviceToken: z.string().optional(),
    })
    .passthrough(),
});

// Refresh Token Schema
const refreshTokenSchema = z.object({
  body: z
    .object({
      sessionId: z.string().optional(),
      refreshToken: z.string().optional(),
    })
    .optional(),
});

// Forgot Password Schema
const forgetPasswordSchema = z.object({
  body: z
    .object({
      email: z
        .string({ error: 'Email is required' })
        .email('Invalid email address')
        .transform(val => val.toLowerCase().trim()),
    })
    .passthrough(),
});

// Reset Password Schema
const resetPasswordSchema = z.object({
  body: z
    .object({
      email: z
        .string()
        .email('Invalid email address')
        .transform(val => val.toLowerCase().trim())
        .optional(),
      token: z.string().optional(),
      newPassword: z
        .string({ error: 'Password is required' })
        .min(8, 'Password must be at least 8 characters long'),
      confirmPassword: z.string().optional(),
    })
    .passthrough(),
});

// Change Password Schema
const changePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: z.string().optional(),
      oldPassword: z.string().optional(),
      newPassword: z
        .string({ error: 'New Password is required' })
        .min(8, 'Password must be at least 8 characters long'),
      confirmPassword: z.string().optional(),
    })
    .passthrough()
    .superRefine((data, ctx) => {
      if (!data.currentPassword && !data.oldPassword) {
        ctx.addIssue({
          code: 'custom',
          message: 'Current password is required',
          path: ['oldPassword'],
        });
      }
    }),
});

const createChangePasswordZodSchema = z.object({
  body: z
    .object({
      currentPassword: z.string().optional(),
      oldPassword: z.string().optional(),
      newPassword: z
        .string({ error: 'New Password is required' })
        .min(8, 'Password must be at least 8 characters long'),
      confirmPassword: z.string({
        error: 'Confirm Password is required',
      }),
    })
    .passthrough()
    .superRefine((data, ctx) => {
      if (!data.currentPassword && !data.oldPassword) {
        ctx.addIssue({
          code: 'custom',
          message: 'Current password is required',
          path: ['oldPassword'],
        });
      }
      if (data.confirmPassword && data.newPassword !== data.confirmPassword) {
        ctx.addIssue({
          code: 'custom',
          message: 'Passwords do not match',
          path: ['confirmPassword'],
        });
      }
    }),
});

// Claim Admin Schema
const claimAdminZodSchema = z.object({
  body: z
    .object({
      email: z
        .string({ error: 'Email is required' })
        .email('Invalid email address')
        .transform(val => val.toLowerCase().trim()),
      currentPassword: z.string({
        error: 'Current password is required',
      }),
      newPassword: z
        .string({ error: 'New password is required' })
        .min(8, 'Password must be at least 8 characters long')
        .max(128, 'Password cannot exceed 128 characters'),
      confirmPassword: z.string().optional(),
    })
    .passthrough(),
});

export const AuthValidation = {
  registerUserZodSchema,
  registerSchema: registerUserZodSchema,
  verifyOtpSchema,
  verifyEmailSchema: verifyOtpSchema,
  resendOtpSchema,
  resendVerificationSchema: resendOtpSchema,
  loginSchema,
  refreshTokenSchema,
  refreshSchema: refreshTokenSchema,
  forgetPasswordSchema,
  forgotPasswordSchema: forgetPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  createChangePasswordZodSchema,
  claimAdminZodSchema,

  // Backward-compatibility aliases
  createRegisterZodSchema: registerUserZodSchema,
  createVerifyEmailZodSchema: verifyOtpSchema,
  createLoginZodSchema: loginSchema,
  createRefreshTokenZodSchema: refreshTokenSchema,
  createForgetPasswordZodSchema: forgetPasswordSchema,
  createResetPasswordZodSchema: resetPasswordSchema,
  changePasswordZodSchema: changePasswordSchema,
};

// Inferred Types
export type IRegisterUserReq = z.infer<typeof registerUserZodSchema>['body'];
export type IVerifyOtpReq = z.infer<typeof verifyOtpSchema>['body'];
export type IResendOtpReq = z.infer<typeof resendOtpSchema>['body'];
export type ILoginReq = z.infer<typeof loginSchema>['body'];
export type IRefreshTokenReq = NonNullable<
  z.infer<typeof refreshTokenSchema>
>['body'];
export type IForgetPasswordReq = z.infer<typeof forgetPasswordSchema>['body'];
export type IResetPasswordReq = z.infer<typeof resetPasswordSchema>['body'];
export type IChangePasswordReq = z.infer<typeof changePasswordSchema>['body'];
export type IClaimAdminReq = z.infer<typeof claimAdminZodSchema>['body'];
