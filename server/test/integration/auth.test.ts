import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/lib/crypto.ts';
import { browser, createTestContext, resetDatabase, signedInUser, tokenFromEmail } from '../helpers.ts';

const { app, prisma, mailer } = createTestContext();
const API = '/api/v1/auth';

beforeEach(async () => {
  await resetDatabase(prisma);
  mailer.clear();
});
afterAll(() => prisma.$disconnect());

describe('registration and sign-in (FR-001, FR-002)', () => {
  it('registers, signs the user in, and never returns secrets', async () => {
    const c = browser(app);
    const res = await c.post(`${API}/register`, { name: 'Asha', email: 'Asha@Example.com', password: 'password-123' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Asha', email: 'asha@example.com', emailVerified: false });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);

    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await c.get(`${API}/me`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('asha@example.com');
  });

  it('stores only a hash of the session token', async () => {
    const c = browser(app);
    const res = await c.post(`${API}/register`, { name: 'A', email: 'a@example.com', password: 'password-123' });
    const token = /gatherly_sid=([^;]+)/.exec(res.headers['set-cookie']?.[0] ?? '')![1]!;
    const session = await prisma.userSession.findFirstOrThrow();
    expect(session.tokenHash).toBe(hashToken(token));
    expect(session.tokenHash).not.toBe(token);
  });

  it('rejects a duplicate email with 409', async () => {
    await browser(app).post(`${API}/register`, { name: 'A', email: 'dup@example.com', password: 'password-123' });
    const res = await browser(app).post(`${API}/register`, { name: 'B', email: 'DUP@example.com', password: 'password-456' });
    expect(res.status).toBe(409);
  });

  it('returns field errors for invalid input', async () => {
    const res = await browser(app).post(`${API}/register`, { name: '', email: 'bad', password: 'short' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  it('gives the same error for unknown email and wrong password', async () => {
    const { email } = await signedInUser(app);
    const wrongPw = await browser(app).post(`${API}/login`, { email, password: 'not-the-password1' });
    const noUser = await browser(app).post(`${API}/login`, { email: 'ghost@example.com', password: 'whatever-123' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body.error.message).toBe(noUser.body.error.message);
  });

  it('signs in with the right password (email is case-insensitive)', async () => {
    const { email, password } = await signedInUser(app);
    const c = browser(app);
    const res = await c.post(`${API}/login`, { email: email.toUpperCase(), password });
    expect(res.status).toBe(200);
    expect((await c.get(`${API}/me`)).status).toBe(200);
  });

  it('logout revokes the session server-side', async () => {
    const { client } = await signedInUser(app);
    expect((await client.post(`${API}/logout`)).status).toBe(204);
    expect((await client.get(`${API}/me`)).status).toBe(401);
    const session = await prisma.userSession.findFirstOrThrow();
    expect(session.revokedAt).not.toBeNull();
  });

  it('blocks state-changing requests from other origins (CSRF)', async () => {
    const res = await browser(app)
      .agent.post(`${API}/login`)
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@example.com', password: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('password reset (FR-003)', () => {
  it('emails a single-use link, resets the password and signs out everywhere', async () => {
    const { client, email } = await signedInUser(app);

    const req = await browser(app).post(`${API}/forgot-password`, { email });
    expect(req.status).toBe(202);
    const mail = mailer.lastTo(email);
    expect(mail?.subject).toMatch(/reset/i);
    const token = tokenFromEmail(mail!.text);

    const reset = await browser(app).post(`${API}/reset-password`, { token, password: 'brand-new-pass-1' });
    expect(reset.status).toBe(200);

    // Old session no longer works; new password does; token can't be reused.
    expect((await client.get(`${API}/me`)).status).toBe(401);
    expect((await browser(app).post(`${API}/login`, { email, password: 'brand-new-pass-1' })).status).toBe(200);
    expect((await browser(app).post(`${API}/reset-password`, { token, password: 'another-pass-2' })).status).toBe(400);
  });

  it('does not reveal whether an account exists', async () => {
    const res = await browser(app).post(`${API}/forgot-password`, { email: 'nobody@example.com' });
    expect(res.status).toBe(202);
    expect(mailer.sent).toHaveLength(0);
  });

  it('only the newest reset link works', async () => {
    const { email } = await signedInUser(app);
    await browser(app).post(`${API}/forgot-password`, { email });
    const first = tokenFromEmail(mailer.lastTo(email)!.text);
    await browser(app).post(`${API}/forgot-password`, { email });
    const second = tokenFromEmail(mailer.lastTo(email)!.text);

    expect((await browser(app).post(`${API}/reset-password`, { token: first, password: 'new-pass-1234' })).status).toBe(400);
    expect((await browser(app).post(`${API}/reset-password`, { token: second, password: 'new-pass-1234' })).status).toBe(200);
  });

  it('rejects expired links', async () => {
    const { email } = await signedInUser(app);
    await browser(app).post(`${API}/forgot-password`, { email });
    const token = tokenFromEmail(mailer.lastTo(email)!.text);
    await prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await browser(app).post(`${API}/reset-password`, { token, password: 'new-pass-1234' })).status).toBe(400);
  });
});

describe('email verification', () => {
  it('sends a confirmation link on sign-up that verifies the account', async () => {
    const { client, email } = await signedInUser(app);
    const token = tokenFromEmail(mailer.lastTo(email)!.text);
    expect((await browser(app).post(`${API}/verify-email`, { token })).status).toBe(200);
    expect((await client.get(`${API}/me`)).body.user.emailVerified).toBe(true);
  });
});

describe('profile and password change (FR-004, FR-005)', () => {
  it('updates name and adds/removes a phone number', async () => {
    const { client } = await signedInUser(app);
    const added = await client.patch('/api/v1/users/me', { name: 'Asha Rao', phone: '+91 98765 43210' });
    expect(added.status).toBe(200);
    expect(added.body.user).toMatchObject({ name: 'Asha Rao', phone: '+91 98765 43210' });

    const removed = await client.patch('/api/v1/users/me', { phone: '' });
    expect(removed.body.user.phone).toBeNull();
  });

  it('requires sign-in for profile changes', async () => {
    expect((await browser(app).patch('/api/v1/users/me', { name: 'X' })).status).toBe(401);
  });

  it('changing password keeps this device signed in but signs out others', async () => {
    const { client: deviceA, email, password } = await signedInUser(app);
    const deviceB = browser(app);
    await deviceB.post(`${API}/login`, { email, password });

    const res = await deviceA.post(`${API}/change-password`, { currentPassword: password, newPassword: 'changed-pass-99' });
    expect(res.status).toBe(200);
    expect((await deviceA.get(`${API}/me`)).status).toBe(200);
    expect((await deviceB.get(`${API}/me`)).status).toBe(401);
  });

  it('rejects a wrong current password', async () => {
    const { client } = await signedInUser(app);
    const res = await client.post(`${API}/change-password`, { currentPassword: 'wrong-pass-1', newPassword: 'changed-pass-99' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.currentPassword).toBeDefined();
  });
});
