import { env, LICENSE, logger } from '@wootrico/config';
import { prisma } from '@wootrico/db';
import { verifyLicenseToken } from './verify.js';
import { decryptLicenseKey, getLicenseState, updateLicenseState } from './store.js';
import { evaluateLicense } from './state-machine.js';

async function telemetry() {
  const integrationCount = await prisma.integration.count().catch(() => 0);
  return { appVersion: env.APP_VERSION, integrationCount };
}

/**
 * Periodic heartbeat: refreshes the signed token (sliding expiry) or applies a
 * revocation. Network failures are non-fatal — the state machine handles
 * grace/blocked based on token expiry.
 */
export async function runHeartbeat(): Promise<{ status: string }> {
  const state = await getLicenseState();
  const key = decryptLicenseKey(state);
  if (!key || !state.instanceId || !state.signedToken) {
    return { status: state.status };
  }

  try {
    const res = await fetch(`${env.LICENSE_SERVER_URL}/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key,
        instanceId: state.instanceId,
        token: state.signedToken,
        telemetry: await telemetry(),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      token?: string;
      revoked?: boolean;
      error?: string;
    };

    if (res.ok && data.revoked) {
      await updateLicenseState({ status: 'blocked', lastError: 'revoked' });
      logger.warn('license revoked by server');
      return { status: 'blocked' };
    }

    if (res.ok && data.token) {
      const claims = await verifyLicenseToken(data.token);
      const now = new Date();
      await updateLicenseState({
        signedToken: data.token,
        tokenExpiresAt: new Date((claims.exp ?? 0) * 1000),
        lastHeartbeatAt: now,
        nextHeartbeatAt: new Date(now.getTime() + LICENSE.heartbeatIntervalMs),
        status: 'active',
        graceUntil: null,
        features: (claims.feat ?? state.features ?? {}) as object,
        lastError: null,
      });
      return { status: 'active' };
    }

    await updateLicenseState({ lastError: data.error ?? `heartbeat_${res.status}` });
  } catch (err) {
    await updateLicenseState({ lastError: (err as Error).message });
    logger.warn({ err }, 'heartbeat failed (non-fatal)');
  }

  // Fall back to expiry-based evaluation (may move to grace/blocked).
  const status = await evaluateLicense();
  return { status };
}
