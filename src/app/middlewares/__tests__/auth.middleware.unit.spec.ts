import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Role, AccountStatus } from '@prisma/client';
import auth from '../auth';
import { jwtHelper } from '../../../helpers/jwtHelper';
import { USER_ROLES, ACCOUNT_STATE } from '../../../enums/user';
import ApiError from '../../../errors/ApiError';
import { JwtUser } from '../../../types';
import prisma from '../../../shared/prisma';

// The middleware reads the live account status / session from the DB.
vi.mock('../../../shared/prisma', () => {
  const mockPrisma = {
    user: { findUnique: vi.fn() },
    session: { findUnique: vi.fn() },
  };
  return { prisma: mockPrisma, default: mockPrisma };
});

/** Sets the account status the DB returns (token claims are ignored for status). */
const mockDbStatus = (status: AccountStatus, deletedAt: Date | null = null) => {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ status, deletedAt } as never);
};

describe('Auth Middleware (BDD Suite)', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  const getNextError = (): ApiError | undefined => {
    const error: unknown = vi.mocked(next).mock.calls[0]?.[0];
    return error as ApiError | undefined;
  };

  const createValidUser = (overrides?: Partial<JwtUser>): JwtUser => ({
    id: 'usr_12345',
    email: 'test.user@example.com',
    role: USER_ROLES.USER,
    accountState: ACCOUNT_STATE.VERIFIED,
    ...overrides,
  });

  beforeEach(() => {
    req = {
      headers: {},
    };
    res = {};
    next = vi.fn();
    vi.restoreAllMocks();
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.session.findUnique).mockReset();
    mockDbStatus(AccountStatus.ACTIVE);
  });

  // ==========================================
  // 1. AUTHENTICATION & TOKEN EXTRACTION
  // ==========================================
  describe('Authentication & Token Extraction', () => {
    describe('when the Authorization header is missing', () => {
      it('should reject the request with 401 Unauthorized', async () => {
        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.UNAUTHORIZED,
          message: 'Authorization token is required',
        });
      });
    });

    describe('when the Authorization scheme is not Bearer', () => {
      it('should reject non-Bearer schemes (e.g. Basic) with 401 Unauthorized', async () => {
        req.headers = { authorization: 'Basic dXNlcjpwYXNz' };
        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.UNAUTHORIZED,
          message: 'Authorization header must start with "Bearer "',
        });
      });

      it('should reject lowercase "bearer" scheme with 401 Unauthorized', async () => {
        req.headers = { authorization: 'bearer valid.token.here' };
        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.UNAUTHORIZED,
          message: 'Authorization header must start with "Bearer "',
        });
      });
    });

    describe('when the Bearer token is empty or only whitespace', () => {
      it('should reject an empty token with 401 Unauthorized', async () => {
        req.headers = { authorization: 'Bearer ' };
        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.UNAUTHORIZED,
          message: 'Valid token is required',
        });
      });

      it('should reject a whitespace-only token with 401 Unauthorized', async () => {
        req.headers = { authorization: 'Bearer    ' };
        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.UNAUTHORIZED,
          message: 'Valid token is required',
        });
      });
    });
  });

  // ==========================================
  // 2. JWT VERIFICATION ERRORS
  // ==========================================
  describe('JWT Verification Errors', () => {
    beforeEach(() => {
      req.headers = { authorization: 'Bearer some.jwt.token' };
    });

    describe('when token signature is invalid (JsonWebTokenError)', () => {
      it('should map to 401 with "Invalid token"', async () => {
        const jwtError = new Error('invalid signature');
        jwtError.name = 'JsonWebTokenError';
        vi.spyOn(jwtHelper, 'verifyToken').mockImplementation(() => {
          throw jwtError;
        });

        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.UNAUTHORIZED,
          message: 'Invalid token',
        });
      });
    });

    describe('when token has expired (TokenExpiredError)', () => {
      it('should map to 401 with "Token has expired"', async () => {
        const expiredError = new Error('jwt expired');
        expiredError.name = 'TokenExpiredError';
        vi.spyOn(jwtHelper, 'verifyToken').mockImplementation(() => {
          throw expiredError;
        });

        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.UNAUTHORIZED,
          message: 'Token has expired',
        });
      });
    });

    describe('when token is not yet active (NotBeforeError)', () => {
      it('should map to 401 with "Token not active"', async () => {
        const nbfError = new Error('jwt not active');
        nbfError.name = 'NotBeforeError';
        vi.spyOn(jwtHelper, 'verifyToken').mockImplementation(() => {
          throw nbfError;
        });

        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.UNAUTHORIZED,
          message: 'Token not active',
        });
      });
    });

    describe('when an unexpected non-JWT error occurs', () => {
      it('should forward the original error to next() without masking', async () => {
        const customError = new Error('Internal system fault');
        vi.spyOn(jwtHelper, 'verifyToken').mockImplementation(() => {
          throw customError;
        });

        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledWith(customError);
      });
    });
  });

  // ==========================================
  // 3. RUNTIME PAYLOAD VALIDATION
  // ==========================================
  describe('Runtime Payload Validation', () => {
    beforeEach(() => {
      req.headers = { authorization: 'Bearer valid.jwt.token' };
    });

    it('should reject a null payload with 401 Invalid token payload', async () => {
      vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(null as unknown as JwtUser);

      const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
      await middleware(req as Request, res as Response, next);

      expect(getNextError()).toMatchObject({
        statusCode: StatusCodes.UNAUTHORIZED,
        message: 'Invalid token payload',
      });
    });

    it('should reject a string/primitive payload with 401 Invalid token payload', async () => {
      vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue('string_payload' as unknown as JwtUser);

      const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
      await middleware(req as Request, res as Response, next);

      expect(getNextError()).toMatchObject({
        statusCode: StatusCodes.UNAUTHORIZED,
        message: 'Invalid token payload',
      });
    });

    it('should reject a payload missing the "id" claim', async () => {
      vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue({
        role: USER_ROLES.USER,
        email: 'test@example.com',
      } as unknown as JwtUser);

      const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
      await middleware(req as Request, res as Response, next);

      expect(getNextError()).toMatchObject({
        statusCode: StatusCodes.UNAUTHORIZED,
        message: 'Invalid token payload',
      });
    });

    it('should reject a payload missing the "role" claim', async () => {
      vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue({
        id: 'usr_123',
        email: 'test@example.com',
      } as unknown as JwtUser);

      const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
      await middleware(req as Request, res as Response, next);

      expect(getNextError()).toMatchObject({
        statusCode: StatusCodes.UNAUTHORIZED,
        message: 'Invalid token payload',
      });
    });

    it('should reject a payload where "role" is not a string (e.g. array/object)', async () => {
      vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue({
        id: 'usr_123',
        role: ['ADMIN'],
      } as unknown as JwtUser);

      const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
      await middleware(req as Request, res as Response, next);

      expect(getNextError()).toMatchObject({
        statusCode: StatusCodes.UNAUTHORIZED,
        message: 'Invalid token payload',
      });
    });
  });

  // ==========================================
  // 4. ACCOUNT STATE GATING
  // ==========================================
  describe('Account State Gating', () => {
    beforeEach(() => {
      req.headers = { authorization: 'Bearer valid.jwt.token' };
    });

    describe('when user account is SUSPENDED', () => {
      it('should reject with 403 Forbidden if allowRestricted is not enabled', async () => {
        const suspendedUser = createValidUser();
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(suspendedUser);
        mockDbStatus(AccountStatus.SUSPENDED);

        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.FORBIDDEN,
          message: 'Your account has been restricted. Contact support.',
        });
      });

      it('should allow access if allowRestricted option is true', async () => {
        const suspendedUser = createValidUser();
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(suspendedUser);
        mockDbStatus(AccountStatus.SUSPENDED);

        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER, { allowRestricted: true });
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.user).toEqual({
          ...suspendedUser,
          status: AccountStatus.SUSPENDED,
          accountState: AccountStatus.SUSPENDED,
        });
      });
    });

    describe('when user account is LOCKED', () => {
      it('should reject with 403 Forbidden', async () => {
        const lockedUser = createValidUser();
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(lockedUser);
        mockDbStatus(AccountStatus.LOCKED);

        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.FORBIDDEN,
          message: 'Your account is temporarily locked due to security reasons. Contact support.',
        });
      });
    });

    describe('when user account is DEACTIVATED', () => {
      it('should reject with 403 Forbidden', async () => {
        const deactivatedUser = createValidUser();
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(deactivatedUser);
        mockDbStatus(AccountStatus.DEACTIVATED);

        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.FORBIDDEN,
          message: 'Your account has been deactivated.',
        });
      });
    });

    describe('when user account is ACTIVE (Prisma AccountStatus.ACTIVE)', () => {
      it('should proceed without error', async () => {
        const activeUser = createValidUser({ status: AccountStatus.ACTIVE });
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(activeUser);

        const middleware = auth(Role.OPERATOR, Role.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.user).toEqual({ ...activeUser, accountState: ACCOUNT_STATE.VERIFIED });
      });
    });

    describe('when user account is VERIFIED or other active state', () => {
      it('should proceed without account restriction error', async () => {
        const verifiedUser = createValidUser({ accountState: ACCOUNT_STATE.VERIFIED });
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(verifiedUser);

        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.user).toEqual({ ...verifiedUser, status: AccountStatus.ACTIVE });
      });
    });
  });

  // ==========================================
  // 5. UNVERIFIED / PENDING ACCOUNT STATE GATING
  // ==========================================
  describe('Unverified Account State Gating', () => {
    beforeEach(() => {
      req.headers = { authorization: 'Bearer valid.jwt.token' };
    });

    describe('when user account is UNVERIFIED', () => {
      it('should reject with 403 Forbidden if allowPending is not enabled', async () => {
        const pendingUser = createValidUser({ accountState: ACCOUNT_STATE.UNVERIFIED });
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(pendingUser);
        mockDbStatus(AccountStatus.UNVERIFIED);

        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.FORBIDDEN,
          message:
            'Your account is pending admin approval. Please wait until your account is verified by an administrator.',
        });
      });

      it('should allow access if allowPending option is true', async () => {
        const pendingUser = createValidUser({ accountState: ACCOUNT_STATE.UNVERIFIED });
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(pendingUser);
        mockDbStatus(AccountStatus.UNVERIFIED);

        const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER, { allowPending: true });
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.user).toEqual({
          ...pendingUser,
          status: AccountStatus.UNVERIFIED,
          accountState: AccountStatus.UNVERIFIED,
        });
      });
    });
  });

  // ==========================================
  // 6. ROLE-BASED ACCESS CONTROL (RBAC)
  // ==========================================
  describe('Role-Based Access Control (RBAC)', () => {
    beforeEach(() => {
      req.headers = { authorization: 'Bearer valid.jwt.token' };
    });

    describe('when route allows a single specific role', () => {
      it('should allow matching user role', async () => {
        const adminUser = createValidUser({ role: USER_ROLES.ADMIN });
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(adminUser);

        const middleware = auth(USER_ROLES.ADMIN);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.user?.role).toBe(USER_ROLES.ADMIN);
      });

      it('should reject non-matching user role with 403 Forbidden', async () => {
        const regularUser = createValidUser({ role: USER_ROLES.USER });
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(regularUser);

        const middleware = auth(USER_ROLES.ADMIN);
        await middleware(req as Request, res as Response, next);

        expect(getNextError()).toMatchObject({
          statusCode: StatusCodes.FORBIDDEN,
          message: "You don't have permission to access this API",
        });
      });
    });

    describe('when route allows multiple roles (e.g. ADMIN and USER)', () => {
      it('should allow USER role', async () => {
        const user = createValidUser({ role: USER_ROLES.USER });
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(user);

        const middleware = auth(USER_ROLES.ADMIN, USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledWith();
      });

      it('should allow ADMIN role', async () => {
        const admin = createValidUser({ role: USER_ROLES.ADMIN });
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(admin);

        const middleware = auth(USER_ROLES.ADMIN, USER_ROLES.OPERATOR, USER_ROLES.USER);
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledWith();
      });
    });

    describe('when route has no role restrictions (empty roles list)', () => {
      it('should allow any authenticated user with a valid token regardless of role', async () => {
        const user = createValidUser({ role: USER_ROLES.USER });
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(user);

        const middleware = auth();
        await middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.user).toEqual({ ...user, status: AccountStatus.ACTIVE });
      });
    });
  });

  // ==========================================
  // 7. SUCCESSFUL AUTHENTICATION & CONTEXT
  // ==========================================
  describe('Successful Authentication & Request Context', () => {
    it('should attach the full verified payload to req.user and call next() with no errors', async () => {
      const fullUserPayload: JwtUser = {
        id: 'usr_complete_99',
        email: 'complete@example.com',
        role: USER_ROLES.USER,
        accountState: ACCOUNT_STATE.VERIFIED,
      };

      req.headers = { authorization: 'Bearer valid.jwt.token' };
      vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(fullUserPayload);

      const middleware = auth(USER_ROLES.OPERATOR, USER_ROLES.USER);
      await middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(req.user).toEqual({ ...fullUserPayload, status: AccountStatus.ACTIVE });
    });
  });

  // ==========================================
  // 8. LIVE ACCOUNT STATE (DB is the source of truth, not the token)
  // ==========================================
  describe('Live Account State (DB lookup)', () => {
    beforeEach(() => {
      req.headers = { authorization: 'Bearer valid.jwt.token' };
    });

    it('should reject a token minted while ACTIVE once the account is SUSPENDED in the DB', async () => {
      vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(
        createValidUser({ status: AccountStatus.ACTIVE, accountState: ACCOUNT_STATE.VERIFIED }),
      );
      mockDbStatus(AccountStatus.SUSPENDED);

      await auth(USER_ROLES.USER)(req as Request, res as Response, next);

      expect(getNextError()).toMatchObject({ statusCode: StatusCodes.FORBIDDEN });
    });

    describe('when the token carries a sessionId', () => {
      const sessionUser = () => createValidUser({ sessionId: 'sess_1' });
      const mockSession = (overrides: Record<string, unknown> = {}) =>
        vi.mocked(prisma.session.findUnique).mockResolvedValue({
          userId: 'usr_12345',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          user: { status: AccountStatus.ACTIVE, deletedAt: null },
          ...overrides,
        } as never);

      it('should allow an active, unrevoked session using a single session query', async () => {
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(sessionUser());
        mockSession();

        await auth(USER_ROLES.USER)(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledWith();
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
      });

      it('should reject a revoked session with 401', async () => {
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(sessionUser());
        mockSession({ revokedAt: new Date() });

        await auth(USER_ROLES.USER)(req as Request, res as Response, next);

        expect(getNextError()).toMatchObject({ statusCode: StatusCodes.UNAUTHORIZED });
      });

      it('should reject an expired session with 401', async () => {
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(sessionUser());
        mockSession({ expiresAt: new Date(Date.now() - 1000) });

        await auth(USER_ROLES.USER)(req as Request, res as Response, next);

        expect(getNextError()).toMatchObject({ statusCode: StatusCodes.UNAUTHORIZED });
      });

      it('should reject a session that belongs to another user with 401', async () => {
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(sessionUser());
        mockSession({ userId: 'usr_other' });

        await auth(USER_ROLES.USER)(req as Request, res as Response, next);

        expect(getNextError()).toMatchObject({ statusCode: StatusCodes.UNAUTHORIZED });
      });

      it('should reject an unknown session with 401', async () => {
        vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(sessionUser());
        vi.mocked(prisma.session.findUnique).mockResolvedValue(null);

        await auth(USER_ROLES.USER)(req as Request, res as Response, next);

        expect(getNextError()).toMatchObject({ statusCode: StatusCodes.UNAUTHORIZED });
      });
    });

    it('should reject with 401 when the account was deleted', async () => {
      vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(createValidUser());
      mockDbStatus(AccountStatus.ACTIVE, new Date());

      await auth(USER_ROLES.USER)(req as Request, res as Response, next);

      expect(getNextError()).toMatchObject({ statusCode: StatusCodes.UNAUTHORIZED });
    });

    it('should reject with 401 when the account no longer exists', async () => {
      vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(createValidUser());
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await auth(USER_ROLES.USER)(req as Request, res as Response, next);

      expect(getNextError()).toMatchObject({ statusCode: StatusCodes.UNAUTHORIZED });
    });

    it('should reject a wrong role without querying the DB', async () => {
      vi.spyOn(jwtHelper, 'verifyToken').mockReturnValue(createValidUser({ role: USER_ROLES.USER }));

      await auth(USER_ROLES.ADMIN)(req as Request, res as Response, next);

      expect(getNextError()).toMatchObject({ statusCode: StatusCodes.FORBIDDEN });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.session.findUnique).not.toHaveBeenCalled();
    });
  });
});
