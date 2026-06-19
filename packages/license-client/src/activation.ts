import { env, LICENSE } from '@wootrico/config';
import { prisma } from '@wootrico/db';
import { getOrCreateInstanceId } from './fingerprint.js';
import { verifyLicenseToken } from './verify.js';
import { encryptLicenseKey, getLicenseState, updateLicenseState, decryptLicenseKey } from './store.js';

export class LicenseError extends Error {}

async function resolvePublicBaseUrl(): Promise<string> {
  const s = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  return s?.publicBaseUrl ?? env.PUBLIC_BASE_URL;
}

export interface ActivationResult {
  status: 'active';
  features: Record<string, unknown>;
  instanceId: string;
}

/**
 * Self-service provisioning: ask the license server to mint AND bind a key for
 * this instance in one online call, identified by the user's name/email. The
 * raw key is returned once and stored encrypted locally for later heartbeats.
 * The server enforces one active key per instanceId.
 */
export async function provisionLicense(owner: {
  name?: string | null;
  email?: string | null;
}): Promise<ActivationResult> {
  const instanceId = await getOrCreateInstanceId();

  let res: Response;
  try {
    res = await fetch(`${env.LICENSE_SERVER_URL}/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: owner.name ?? undefined,
        email: owner.email ?? undefined,
        instanceId,
        appVersion: env.APP_VERSION,
        publicBaseUrl: await resolvePublicBaseUrl(),
      }),
    });
  } catch (err) {
    throw new LicenseError(`license server unreachable: ${(err as Error).message}`);
  }

  const data = (await res.json().catch(() => ({}))) as {
    key?: string;
    token?: string;
    error?: string;
    features?: Record<string, unknown>;
  };
  if (!res.ok || !data.token) {
    throw new LicenseError(data.error ?? `provision_failed_${res.status}`);
  }

  const claims = await verifyLicenseToken(data.token);
  const now = new Date();
  await updateLicenseState({
    // On reuse the server omits `key`; keep whatever is already stored.
    ...(data.key ? { licenseKey: encryptLicenseKey(data.key) } : {}),
    instanceId,
    signedToken: data.token,
    tokenExpiresAt: new Date((claims.exp ?? 0) * 1000),
    status: 'active',
    features: (claims.feat ?? data.features ?? {}) as object,
    lastHeartbeatAt: now,
    nextHeartbeatAt: new Date(now.getTime() + LICENSE.heartbeatIntervalMs),
    graceUntil: null,
    lastError: null,
  });

  return { status: 'active', features: (claims.feat ?? {}) as Record<string, unknown>, instanceId };
}

/** Activate a license key against the central server (online, once). */
export async function activateLicense(licenseKey: string): Promise<ActivationResult> {
  const instanceId = await getOrCreateInstanceId();

  let res: Response;
  try {
    res = await fetch(`${env.LICENSE_SERVER_URL}/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: licenseKey,
        instanceId,
        appVersion: env.APP_VERSION,
        publicBaseUrl: await resolvePublicBaseUrl(),
      }),
    });
  } catch (err) {
    throw new LicenseError(`license server unreachable: ${(err as Error).message}`);
  }

  const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string; features?: Record<string, unknown> };
  if (!res.ok || !data.token) {
    throw new LicenseError(data.error ?? `activation_failed_${res.status}`);
  }

  const claims = await verifyLicenseToken(data.token);
  const now = new Date();
  await updateLicenseState({
    licenseKey: encryptLicenseKey(licenseKey),
    instanceId,
    signedToken: data.token,
    tokenExpiresAt: new Date((claims.exp ?? 0) * 1000),
    status: 'active',
    features: (claims.feat ?? data.features ?? {}) as object,
    lastHeartbeatAt: now,
    nextHeartbeatAt: new Date(now.getTime() + LICENSE.heartbeatIntervalMs),
    graceUntil: null,
    lastError: null,
  });

  return { status: 'active', features: (claims.feat ?? {}) as Record<string, unknown>, instanceId };
}

/** Release the binding so the key can be moved to another instance. */
export async function deactivateLicense(): Promise<void> {
  const state = await getLicenseState();
  const key = decryptLicenseKey(state);
  if (key && state.instanceId) {
    await fetch(`${env.LICENSE_SERVER_URL}/deactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, instanceId: state.instanceId }),
    }).catch(() => undefined);
  }
  await updateLicenseState({
    licenseKey: null,
    signedToken: null,
    tokenExpiresAt: null,
    status: 'unactivated',
    graceUntil: null,
    lastError: null,
  });
}
