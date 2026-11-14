import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing uses Node's built-in scrypt: memory-hard, no native add-on to compile on
 * the host, and parameters are stored with each hash so they can be raised later.
 * Format: scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>
 */
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function scryptOptions(N: number, r: number, p: number): ScryptOptions {
  // maxmem must exceed 128 * N * r bytes.
  return { N, r, p, maxmem: 256 * N * r };
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = SCRYPT_PARAMS;
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, scryptOptions(N, r, p));
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (![N, r, p].every(Number.isInteger)) return false;

  const expected = Buffer.from(hashB64, 'base64url');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, scryptOptions(N, r, p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A precomputed hash used to keep login timing constant when the email doesn't exist. */
let dummyHash: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  return dummyHash;
}

/** 256-bit URL-safe random token (sessions, reset links, invitations). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as SHA-256 hashes, so a database leak does not expose live tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
