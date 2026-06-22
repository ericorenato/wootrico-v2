import { LICENSE, type LicenseStatus } from '@wootrico/config';
import type { LicenseState } from '@wootrico/db';
import { getLicenseState, updateLicenseState } from './store.js';

/**
 * Pure status computation from stored state + current time. Validation is online:
 * the server's last answer is cached in `status`/`lastValidatedAt`. `blocked` is
 * sticky until a fresh successful validation flips it back to `active`.
 */
export function computeStatus(state: LicenseState, now = new Date()): LicenseStatus {
  if (state.status === 'blocked') return 'blocked'; // sticky until re-validated active
  if (!state.licenseKey || !state.instanceId) return 'unactivated';
  if (!state.lastValidatedAt) {
    // A key exists but was never confirmed online (fresh migration / mid-rollout).
    // Allow it briefly as 'warning' until the next validation runs.
    return state.status === 'active' ? 'warning' : 'unactivated';
  }

  const since = now.getTime() - state.lastValidatedAt.getTime();
  if (since <= LICENSE.validateIntervalMs) return 'active';
  if (since <= LICENSE.cacheGraceMs) return 'warning'; // serving from cache during a blip
  return 'blocked'; // cache window exceeded without a successful re-check
}

/** Recompute, persist when it changes, and return the status. */
export async function evaluateLicense(now = new Date()): Promise<LicenseStatus> {
  const state = await getLicenseState();
  const status = computeStatus(state, now);
  if (status !== state.status) await updateLicenseState({ status });
  return status;
}

/**
 * Whether message processing is allowed for the given status. Licensing is
 * ALWAYS enforced (no opt-out): an unactivated or blocked instance cannot
 * process — only active/warning may.
 */
export function isProcessingAllowed(status: LicenseStatus): boolean {
  return status === 'active' || status === 'warning';
}

/** Convenience gate used by ingress + worker. */
export async function assertLicenseActive(): Promise<{ allowed: boolean; status: LicenseStatus }> {
  const status = await evaluateLicense();
  return { allowed: isProcessingAllowed(status), status };
}
