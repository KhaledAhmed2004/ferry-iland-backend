import { AccountStatus, Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../../../app';
import { EmailService } from '../../../../helpers/email/email.service';
import { memory as rateLimitStore } from '../../../middlewares/rateLimit';
import { createUser, prisma, resetDb } from '../../../../../test/integration/helpers';

/**
 * Login, lockout, refresh-token rotation, logout and password reset against a real Postgres.
 * Run with `npm run test:int`.
 */
const api = () => request(app);
const PASSWORD = 'Password123!';
const PROTECTED = '/api/v1/bookings/my'; // any signed-in route; checks live session + status

let passwordHash: string;
const sendEmail = vi.spyOn(EmailService, 'sendEmail').mockResolvedValue(undefined);

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 4);
});

beforeEach(async () => {
  await resetDb();
  rateLimitStore.flushAll(); // login is limited to 5/min per IP
  sendEmail.mockClear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const makeUser = (overrides: Parameters<typeof createUser>[1] = {}) =>
  createUser(Role.USER, { passwordHash, ...overrides });

const login = (email: string, password = PASSWORD, mobile = false) => {
  const req = api().post('/api/v1/auth/login');
  if (mobile) req.set('x-client-type', 'mobile');
  return req.send({ email, password });
};

/** Mobile login: the body carries the refresh token. */
async function mobileSession(email: string) {
  const res = await login(email, PASSWORD, true);
  expect(res.status).toBe(200);
  const { accessToken, refreshToken, sessionId } = res.body.data;
  return { accessToken, refreshToken, sessionId, bearer: `Bearer ${accessToken}` };
}

const refreshCookie = (res: request.Response) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('refreshToken='));

describe('POST /api/v1/auth/login', () => {
  it('200: web login sets an httpOnly refresh cookie and keeps the refresh token out of the body', async () => {
    const user = await makeUser();

    const res = await login(user.email);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(refreshCookie(res)).toMatch(/HttpOnly/i);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);

    const me = await api().get(PROTECTED).set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('200: mobile login returns the refresh token in the body', async () => {
    const user = await makeUser();
    const s = await mobileSession(user.email);
    expect(s.refreshToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('401: wrong password and unknown email give the same answer', async () => {
    const user = await makeUser();

    const wrong = await login(user.email, 'Wrong-pass1!');
    const unknown = await login('nobody@test.local');

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('403: unverified and suspended accounts cannot log in', async () => {
    const unverified = await makeUser({ status: AccountStatus.UNVERIFIED, isEmailVerified: false });
    const suspended = await makeUser({ status: AccountStatus.SUSPENDED });

    expect((await login(unverified.email)).status).toBe(403);
    expect((await login(suspended.email)).status).toBe(403);
    expect(await prisma.session.count()).toBe(0);
  });

  it('lockout: 5 wrong passwords lock the account; the right one works only after the lock expires', async () => {
    const user = await makeUser();

    const attempts = [];
    for (let i = 0; i < 5; i++) attempts.push((await login(user.email, 'Wrong-pass1!')).status);
    expect(attempts).toEqual([401, 401, 401, 401, 403]);

    rateLimitStore.flushAll();
    const whileLocked = await login(user.email);
    expect(whileLocked.status, 'correct password must not bypass the lock').toBe(403);

    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const afterLock = await login(user.email);
    expect(afterLock.status).toBe(200);

    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved).toMatchObject({ status: AccountStatus.ACTIVE, failedLoginAttempts: 0, lockedUntil: null });
  });

  it('429: the 6th login from one IP within a minute is rate limited', async () => {
    const user = await makeUser();
    for (let i = 0; i < 5; i++) await login(user.email);

    const sixth = await login(user.email);

    expect(sixth.status).toBe(429);
    expect(sixth.headers['retry-after']).toBeDefined();
  });
});

describe('POST /api/v1/auth/refresh — rotation', () => {
  it('200: rotates the refresh token; the new access token works', async () => {
    const user = await makeUser();
    const s = await mobileSession(user.email);

    const res = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client-type', 'mobile')
      .send({ sessionId: s.sessionId, refreshToken: s.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.refreshToken).not.toBe(s.refreshToken);
    const me = await api().get(PROTECTED).set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('401: reusing an old refresh token revokes the whole session (theft detection)', async () => {
    const user = await makeUser();
    const s = await mobileSession(user.email);
    const rotated = await api()
      .post('/api/v1/auth/refresh')
      .set('x-client-type', 'mobile')
      .send({ sessionId: s.sessionId, refreshToken: s.refreshToken });
    expect(rotated.status).toBe(200);

    const replay = await api().post('/api/v1/auth/refresh').send({ sessionId: s.sessionId, refreshToken: s.refreshToken });
    expect(replay.status).toBe(401);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(session.revokedReason).toBe('REUSE_DETECTED');
    const legit = await api()
      .post('/api/v1/auth/refresh')
      .send({ sessionId: s.sessionId, refreshToken: rotated.body.data.refreshToken });
    expect(legit.status, 'after reuse, even the latest token is dead').toBe(401);
    expect((await api().get(PROTECTED).set('Authorization', s.bearer)).status).toBe(401);
  });

  it('200: web refresh with only the httpOnly cookies (how a browser calls it)', async () => {
    const user = await makeUser();
    const loginRes = await login(user.email);
    const cookies = ([] as string[]).concat(loginRes.headers['set-cookie'] ?? []);
    expect(cookies.find((c) => c.startsWith('sessionId='))).toMatch(/HttpOnly/i);
    const jar = cookies.map((c) => c.split(';')[0]).join('; ');

    const res = await api().post('/api/v1/auth/refresh').set('Cookie', jar).send({});

    expect(res.status, 'cookie-only refresh should work for the web client').toBe(200);
    expect(refreshCookie(res)).toBeTruthy();
  });

  it('401: a suspended user cannot refresh', async () => {
    const user = await makeUser();
    const s = await mobileSession(user.email);
    await prisma.user.update({ where: { id: user.id }, data: { status: AccountStatus.SUSPENDED } });

    const res = await api().post('/api/v1/auth/refresh').send({ sessionId: s.sessionId, refreshToken: s.refreshToken });

    expect(res.status).toBe(401);
  });
});

describe('Logout', () => {
  it('POST /logout kills the current access token and its refresh token', async () => {
    const user = await makeUser();
    const s = await mobileSession(user.email);

    const out = await api().post('/api/v1/auth/logout').set('Authorization', s.bearer).send({});
    expect(out.status).toBe(200);

    expect((await api().get(PROTECTED).set('Authorization', s.bearer)).status).toBe(401);
    const refresh = await api().post('/api/v1/auth/refresh').send({ sessionId: s.sessionId, refreshToken: s.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('POST /logout-all signs out every device', async () => {
    const user = await makeUser();
    const phone = await mobileSession(user.email);
    const laptop = await mobileSession(user.email);

    await api().post('/api/v1/auth/logout-all').set('Authorization', phone.bearer).send({}).expect(200);

    expect((await api().get(PROTECTED).set('Authorization', phone.bearer)).status).toBe(401);
    expect((await api().get(PROTECTED).set('Authorization', laptop.bearer)).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it("a user cannot log out someone else's session by sending its sessionId", async () => {
    const attacker = await makeUser();
    const victim = await makeUser();
    const a = await mobileSession(attacker.email);
    const v = await mobileSession(victim.email);

    await api().post('/api/v1/auth/logout').set('Authorization', a.bearer).send({ sessionId: v.sessionId });

    const victimStillIn = await api().get(PROTECTED).set('Authorization', v.bearer);
    expect(victimStillIn.status, "victim's session must not be revoked by another user").toBe(200);
  });
});

describe('Password reset', () => {
  const resetTokenFromEmail = () => {
    const html = String(sendEmail.mock.calls.at(-1)?.[0]?.html ?? '');
    return html.match(/[0-9a-f]{64}/)?.[0];
  };

  it('200 with the same message for unknown email, and no email is sent', async () => {
    const user = await makeUser();

    const known = await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
    const unknown = await api().post('/api/v1/auth/forgot-password').send({ email: 'nobody@test.local' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body.message).toBe(known.body.message);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('reset: new password works, old fails, all sessions revoked, token is single-use', async () => {
    const user = await makeUser();
    const before = await mobileSession(user.email);
    await api().post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);
    const token = resetTokenFromEmail();
    expect(token).toBeTruthy();

    const newPassword = 'NewPassword456!';
    const reset = await api().post('/api/v1/auth/reset-password').send({ email: user.email, token, newPassword });
    expect(reset.status).toBe(200);

    expect((await api().get(PROTECTED).set('Authorization', before.bearer)).status).toBe(401);
    rateLimitStore.flushAll();
    expect((await login(user.email)).status).toBe(401);
    expect((await login(user.email, newPassword)).status).toBe(200);

    const again = await api().post('/api/v1/auth/reset-password').send({ email: user.email, token, newPassword: 'Another789!' });
    expect(again.status).toBe(400);
  });

  it('400: wrong reset token changes nothing', async () => {
    const user = await makeUser();
    await api().post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);

    const res = await api()
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, token: 'f'.repeat(64), newPassword: 'NewPassword456!' });

    expect(res.status).toBe(400);
    expect((await login(user.email)).status).toBe(200);
  });
});
