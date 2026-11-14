import { describe, expect, it } from 'vitest';
import { registerSchema, updateProfileSchema } from '@gatherly/shared';

describe('registerSchema', () => {
  it('normalises email to lower case and trims whitespace', () => {
    const r = registerSchema.parse({ name: '  Asha  ', email: '  Asha@Example.COM ', password: 'longenough1' });
    expect(r).toEqual({ name: 'Asha', email: 'asha@example.com', password: 'longenough1' });
  });

  it('rejects weak passwords and bad emails with field messages', () => {
    const r = registerSchema.safeParse({ name: 'A', email: 'nope', password: 'short' });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path[0]);
    expect(paths).toContain('email');
    expect(paths).toContain('password');
  });

  it('requires letters and numbers in passwords', () => {
    expect(registerSchema.safeParse({ name: 'A', email: 'a@b.co', password: 'onlyletterss' }).success).toBe(false);
    expect(registerSchema.safeParse({ name: 'A', email: 'a@b.co', password: '1234567890' }).success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('turns an empty phone into null so it can be removed (FR-005)', () => {
    expect(updateProfileSchema.parse({ phone: '' }).phone).toBeNull();
  });

  it('rejects phone numbers with letters', () => {
    expect(updateProfileSchema.safeParse({ phone: '98765abc' }).success).toBe(false);
  });
});
