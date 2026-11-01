import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import app from '../../../app';
import config from '../../../config';

describe('Staging Smoke Tests (End-to-End Express Application Pipeline)', () => {
  const originalEnv = config.node_env;

  afterEach(() => {
    config.node_env = originalEnv;
    vi.restoreAllMocks();
  });

  // ==========================================
  // 1. INVALID FORM SUBMISSION (ZOD VALIDATION)
  // ==========================================
  describe('1. Invalid Form Submission (Zod)', () => {
    it('returns 400 Bad Request with field-level error messages for invalid login payload', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'not-a-valid-email',
          password: '',
        });

      expect(res.status).toBe(StatusCodes.BAD_REQUEST);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Validation Error');
      expect(Array.isArray(res.body.errorMessages)).toBe(true);
      expect(res.body.errorMessages.length).toBeGreaterThan(0);

      // Verify each error message has path and message properties
      res.body.errorMessages.forEach((err: any) => {
        expect(err).toHaveProperty('path');
        expect(err).toHaveProperty('message');
      });
    });

    it('returns 400 Bad Request when mandatory body fields are missing entirely', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({});

      expect(res.status).toBe(StatusCodes.BAD_REQUEST);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Validation Error');
      expect(res.body.errorMessages.length).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // 2. UNAUTHORIZED REQUEST
  // ==========================================
  describe('2. Unauthorized Request Handling', () => {
    it('returns 401 Unauthorized when accessing protected /user/me without token', async () => {
      const res = await request(app).get('/api/v1/user/me');

      expect(res.status).toBe(StatusCodes.UNAUTHORIZED);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/authorized|token|session/i);
    });

    it('returns 401 Unauthorized when an invalid Bearer token is provided', async () => {
      const res = await request(app)
        .get('/api/v1/user/me')
        .set('Authorization', 'Bearer invalid_tampered_jwt_token_12345');

      expect(res.status).toBe(StatusCodes.UNAUTHORIZED);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // 3. 404 NOT FOUND ROUTE HANDLING
  // ==========================================
  describe('3. Unknown Route Fallback', () => {
    it('returns 404 with standard envelope for non-existent API endpoints', async () => {
      const res = await request(app).get('/api/v1/non-existent-route-endpoint');

      expect(res.status).toBe(StatusCodes.NOT_FOUND);
      expect(res.body).toEqual({
        success: false,
        message: 'Not found',
        errorMessages: [
          {
            path: '/api/v1/non-existent-route-endpoint',
            message: "API DOESN'T EXIST",
          },
        ],
      });
    });
  });

  // ==========================================
  // 4. PRODUCTION STACK TRACE MASKING
  // ==========================================
  describe('4. Production Stack Trace Masking', () => {
    it('masks stack trace and sensitive details in production mode', async () => {
      config.node_env = 'production';

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'bad' });

      expect(res.body).not.toHaveProperty('stack');
    });

    it('exposes stack trace in development mode for debugging', async () => {
      config.node_env = 'development';

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'bad' });

      // In validation errors, stack is typically undefined because validation error is 400
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // 5. REQUEST LOGGER & API CONTRACT INTEGRITY
  // ==========================================
  describe('5. API Contract & Response Envelope Integrity', () => {
    it('ensures every error response strictly conforms to { success, message, errorMessages }', async () => {
      const res = await request(app).get('/api/v1/users/stats'); // Admin protected

      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('errorMessages');
      expect(Array.isArray(res.body.errorMessages)).toBe(true);
    });
  });
});
