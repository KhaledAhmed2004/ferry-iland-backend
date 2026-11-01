import { describe, it, expect } from 'vitest';
import { AuthRoutes } from '../auth.route';
import { AuthValidation } from '../auth.validation';

describe('Auth Routes - Canonical Authentication Lifecycle', () => {
  it('should define all canonical authentication endpoints on router', () => {
    const registeredRoutes = AuthRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods),
      }));

    const paths = registeredRoutes.map(r => r.path);

    // Canonical industry standard authentication endpoints
    expect(paths).toContain('/register');
    expect(paths).toContain('/verify-email');
    expect(paths).toContain('/verify-email/resend');
    expect(paths).toContain('/login');
    expect(paths).toContain('/refresh');
    expect(paths).toContain('/logout');
    expect(paths).toContain('/logout-all');
    expect(paths).toContain('/forgot-password');
    expect(paths).toContain('/reset-password');
    expect(paths).toContain('/claim-admin');

    // Reject duplicate user management routes (which belong to /users/me/*)
    expect(paths).not.toContain('/me');
    expect(paths).not.toContain('/change-password');

    // Reject all legacy / redundant duplicate aliases
    expect(paths).not.toContain('/verify-otp');
    expect(paths).not.toContain('/resend-otp');
    expect(paths).not.toContain('/refresh-token');
    expect(paths).not.toContain('/forget-password');
  });

  it('should enforce proper HTTP verbs according to REST semantics', () => {
    const routeMap = new Map<string, string[]>();
    AuthRoutes.stack
      .filter((layer: any) => layer.route)
      .forEach((layer: any) => {
        routeMap.set(layer.route.path, Object.keys(layer.route.methods));
      });

    // POST for state creation, credential submission, and token operations
    expect(routeMap.get('/register')).toContain('post');
    expect(routeMap.get('/login')).toContain('post');
    expect(routeMap.get('/verify-email')).toContain('post');
    expect(routeMap.get('/verify-email/resend')).toContain('post');
    expect(routeMap.get('/refresh')).toContain('post');
    expect(routeMap.get('/logout')).toContain('post');
    expect(routeMap.get('/logout-all')).toContain('post');
    expect(routeMap.get('/forgot-password')).toContain('post');
    expect(routeMap.get('/reset-password')).toContain('post');
    expect(routeMap.get('/claim-admin')).toContain('post');
  });

  describe('Auth Validation Schemas', () => {
    it('should validate strong password requirements for registration', () => {
      const validPayload = {
        body: {
          name: 'John Doe',
          email: 'user@example.com',
          phone: '+1234567890',
          password: 'Password123!',
        },
      };
      const result = AuthValidation.registerUserZodSchema.safeParse(validPayload);
      expect(result.success).toBe(true);

      const weakPassword = {
        body: {
          name: 'John Doe',
          email: 'user@example.com',
          phone: '+1234567890',
          password: 'weak',
        },
      };
      const failResult = AuthValidation.registerUserZodSchema.safeParse(weakPassword);
      expect(failResult.success).toBe(false);
    });

    it('should normalize email to lowercase during validation', () => {
      const payload = {
        body: {
          email: 'TEST.User@EXAMPLE.COM',
          password: 'SecretPassword123!',
        },
      };
      const result = AuthValidation.loginSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.body.email).toBe('test.user@example.com');
      }
    });

    it('should validate OTP format for verify-email', () => {
      const valid = AuthValidation.verifyOtpSchema.safeParse({
        body: {
          email: 'user@example.com',
          otp: '123456',
        },
      });
      expect(valid.success).toBe(true);

      const missingCode = AuthValidation.verifyOtpSchema.safeParse({
        body: {
          email: 'user@example.com',
        },
      });
      expect(missingCode.success).toBe(false);
    });
  });
});
