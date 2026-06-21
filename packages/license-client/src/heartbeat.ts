import { env, LICENSE, logger } from '@wootrico/config';
import { prisma } from '@wootrico/db';
import { decryptLicenseKey, encryptLicenseKey, getLicenseState, updateLicenseState } from './store.js';
import { evaluateLicense } from './state-machine.js';

async function telemetry() {
  const integrationCount = await prisma.integration.count().catch(() => 0);
  return { appVersion: env.APP_VERSION, integrationCount };
}

interface ValidateResponse {
  active?: boolean;
  plan?: string | null;
  expiresAt?: string | null;
  reason?: string;
  key?: string; // server delivers a newly minted key (e.g. paid upgrade) to swap in
  features?: Record<string, unknown>;
  error?: string;
}

/**
 * Periodic online validation. Asks the server "is my key still active?" and
 * caches the answer. Picks up a server-delivered key swap (paid upgrade after a
 * payment) automatically. Network failures are non-fatal — the state machine
 * keeps the last-known-good answer within the cache window, then blocks.
 */
export async function runHeartbeat(): Promise<{ status: string }> {
  const state = await getLicenseState();
  const key = decryptLicenseKey(state);
  if (!key || !state.instanceId) {
    return { status: state.status };
  }

  try {
    const res = await fetch(`${env.LICENSE_SERVER_URL}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, instanceId: state.instanceId, telemetry: await telemetry() }),
    });
    const data = (await res.json().catch(() => ({}))) as ValidateResponse;

    if (res.ok && data.active) {
      const now = new Date();
      await updateLicenseState({
        // Server delivered a new key (paid upgrade) → swap it in.
        ...(data.key ? { licenseKey: encryptLicenseKey(data.key) } : {}),
        plan: data.plan ?? state.plan ?? null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        status: 'active',
        lastHeartbeatAt: now,
        lastValidatedAt: now,
        nextHeartbeatAt: new Date(now.getTime() + LICENSE.validateIntervalMs),
        features: (data.features ?? state.features ?? {}) as object,
        lastError: null,
      });
      return { status: 'active' };
    }

    if (res.ok && data.active === false) {
      await updateLicenseState({ status: 'blocked', lastError: data.reason ?? 'inactive' });
      logger.warn({ reason: data.reason }, 'license inactive per server');
      return { status: 'blocked' };
    }

    await updateLicenseState({ lastError: data.error ?? `validate_${res.status}` });
  } catch (err) {
    await updateLicenseState({ lastError: (err as Error).message });
    logger.warn({ err }, 'license validation failed (non-fatal)');
  }

  // Fall back to cache-window evaluation (may move to warning/blocked).
  const status = await evaluateLicense();
  return { status };
}
