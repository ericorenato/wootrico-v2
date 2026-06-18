import { api } from './api-client';

export interface LicenseStatus {
  status: 'unactivated' | 'active' | 'warning' | 'grace' | 'blocked';
  instanceId: string | null;
  features: Record<string, unknown>;
  tokenExpiresAt: string | null;
  graceUntil: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  serverUrl?: string;
}

export const getLicenseStatus = () => api<LicenseStatus>('/api/license/status');

export const activateLicense = (licenseKey: string) =>
  api<{ status: string; features: Record<string, unknown> }>('/api/license/activate', {
    method: 'POST',
    body: JSON.stringify({ licenseKey }),
  });

export const deactivateLicense = () =>
  api<void>('/api/license/deactivate', { method: 'POST' });
