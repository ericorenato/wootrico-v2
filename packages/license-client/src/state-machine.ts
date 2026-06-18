import { LICENSE, type LicenseStatus, env } from '@wootrico/config';
import type { LicenseState } from '@wootrico/db';
import { getLicenseState, updateLicenseState } from './store.js';

const DAY = 24 * 60 * 60 * 1000;

/** Pure status computation from stored state + current time. */
export function computeStatus(state: LicenseState, now = new Date()): LicenseStatus {
  if (state.status === 'blocked') return 'blocked'; // sticky until reactivation
  if (!state.signedToken || !state.tokenExpiresAt) return 'unactivated';

  const exp = state.tokenExpiresAt.getTime();
  if (now.getTime() <= exp) {
    // token valid; warn if heartbeats have gone stale
    const stale =
      state.lastHeartbeatAt &&
      now.getTime() - state.lastHeartbeatAt.getTime() > 2 * LICENSE.heartbeatIntervalMs;
    return stale ? 'warning' : 'active';
  }

  // token expired → grace then blocked
  const graceUntil = (state.graceUntil?.getTime() ?? exp + LICENSE.graceDays * DAY);
  return now.getTime() < graceUntil ? 'grace' : 'blocked';
}

/** Recompute, persist (incl. graceUntil on first expiry), and return status. */
export async function evaluateLicense(now = new Date()): Promise<LicenseStatus> {
  const state = await getLicenseState();
  const status = computeStatus(state, now);

  const data: Record<string, unknown> = { status };
  if (
    status === 'grace' &&
    !state.graceUntil &&
    state.tokenExpiresAt
  ) {
    data.graceUntil = new Date(state.tokenExpiresAt.getTime() + LICENSE.graceDays * DAY);
  }
  if (status !== state.status || data.graceUntil) await updateLicenseState(data);
  return status;
}

/** Whether message processing is allowed for the given status. */
export function isProcessingAllowed(status: LicenseStatus): boolean {
  if (status === 'blocked') return false;
  if (status === 'unactivated') return !env.LICENSE_REQUIRED;
  return true; // active | warning | grace
}

/** Convenience gate used by ingress + worker. */
export async function assertLicenseActive(): Promise<{ allowed: boolean; status: LicenseStatus }> {
  const status = await evaluateLicense();
  return { allowed: isProcessingAllowed(status), status };
}
