import { importPKCS8, SignJWT, type KeyLike } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { cfg } from './env.js';

let cachedKey: KeyLike | undefined;
async function privateKey(): Promise<KeyLike> {
  if (!cachedKey) cachedKey = await importPKCS8(cfg.privateKeyPem, 'EdDSA');
  return cachedKey;
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateKey(): string {
  return `WTR-${randomBytes(20).toString('base64url')}`;
}

export async function signToken(opts: {
  instanceId: string;
  keyId: string;
  features?: Record<string, unknown> | null;
}): Promise<string> {
  return new SignJWT({ lic: opts.keyId, feat: opts.features ?? {} })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt()
    .setIssuer('wootrico-license')
    .setSubject(opts.instanceId)
    .setExpirationTime(`${cfg.tokenTtlDays}d`)
    .sign(await privateKey());
}
