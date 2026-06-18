import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for secrets-at-rest (Chatwoot tokens, provider
 * credentials, license key). The key comes from APP_ENCRYPTION_KEY (32 raw
 * bytes, base64-encoded).
 *
 * Ciphertext format (base64 of): [12-byte IV][16-byte auth tag][ciphertext]
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let keyCache: Buffer | undefined;

function getKey(): Buffer {
  if (keyCache) return keyCache;
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `APP_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  keyCache = key;
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('Invalid ciphertext');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Encrypt a JSON-serializable value. */
export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

/** Decrypt to a typed JSON value. */
export function decryptJson<T>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T;
}

/** URL-safe random token (used for per-integration webhook tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Keyed HMAC-SHA256 hex digest. Used to pseudonymize PII (e.g. phone numbers in
 * dedup tickets / cache keys) — we only ever compare equality, never reverse it.
 */
export function hmac(value: string): string {
  return createHmac('sha256', getKey()).update(value).digest('hex');
}
