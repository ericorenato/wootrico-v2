import { importSPKI, jwtVerify, type JWTPayload, type KeyLike } from 'jose';
import { env } from '@wootrico/config';

export interface LicenseClaims extends JWTPayload {
  sub: string; // instanceId
  lic?: string; // license key id
  feat?: Record<string, unknown>;
}

let cachedKey: KeyLike | undefined;

async function publicKey(): Promise<KeyLike> {
  if (cachedKey) return cachedKey;
  const b64 = env.LICENSE_PUBLIC_KEY;
  if (!b64) throw new Error('LICENSE_PUBLIC_KEY is not set');
  const pem = Buffer.from(b64, 'base64').toString('utf8');
  cachedKey = await importSPKI(pem, 'EdDSA');
  return cachedKey;
}

/** Verify a license token offline using the embedded public key. */
export async function verifyLicenseToken(token: string): Promise<LicenseClaims> {
  const key = await publicKey();
  const { payload } = await jwtVerify(token, key, {
    issuer: 'wootrico-license',
    algorithms: ['EdDSA'],
  });
  return payload as LicenseClaims;
}
