import { describe, expect, it } from 'vitest';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../../src/lib/crypto.ts';

describe('password hashing', () => {
  it('verifies the correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse 123');
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse 123', hash)).toBe(true);
    expect(await verifyPassword('wrong horse 123', hash)).toBe(false);
  });

  it('salts every hash, so the same password hashes differently', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-1'), hashPassword('same-password-1')]);
    expect(a).not.toBe(b);
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$abc$8$1$salt$hash')).toBe(false);
  });
});

describe('tokens', () => {
  it('generates 256-bit url-safe tokens that are unique', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('hashes tokens deterministically with sha-256 (hex)', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});
