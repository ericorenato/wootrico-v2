import { api } from './api-client';

export interface LicenseStatus {
  status: 'unactivated' | 'active' | 'warning' | 'blocked';
  instanceId: string | null;
  plan: 'trial' | 'paid' | null;
  expiresAt: string | null;
  features: Record<string, unknown>;
  lastValidatedAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  /** License is valid but the last validation couldn't reach the server. */
  offline?: boolean;
  serverUrl?: string;
}

export const getLicenseStatus = () => api<LicenseStatus>('/api/license/status');

export const activateLicense = (licenseKey: string) =>
  api<{ status: string; features: Record<string, unknown> }>('/api/license/activate', {
    method: 'POST',
    body: JSON.stringify({ licenseKey }),
  });

export const provisionLicense = (owner: { name: string; email: string }) =>
  api<{ status: string; features: Record<string, unknown>; instanceId: string }>(
    '/api/license/provision',
    { method: 'POST', body: JSON.stringify(owner) },
  );

export const purchaseLicense = () =>
  api<{ checkoutUrl: string | null }>('/api/license/purchase', { method: 'POST' });

export const deactivateLicense = () =>
  api<void>('/api/license/deactivate', { method: 'POST' });

/** Force an immediate online re-validation (used to recover quickly when blocked). */
export const triggerHeartbeat = () =>
  api<{ status: string }>('/api/license/heartbeat', { method: 'POST' });
