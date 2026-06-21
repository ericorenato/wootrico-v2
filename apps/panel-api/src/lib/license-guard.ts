import { assertLicenseActive } from '@wootrico/license-client';

/**
 * Whether the customer may currently create or activate integrations. Mirrors
 * the message-processing gate: when the license is not active, managing
 * integrations is blocked (the customer can still view existing data).
 */
export async function canManageIntegrations(): Promise<{ allowed: boolean; status: string }> {
  return assertLicenseActive();
}
