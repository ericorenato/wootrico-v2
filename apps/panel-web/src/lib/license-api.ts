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
  serverUrl?: string;
}

export const getLicenseStatus = () => api<LicenseStatus>('/api/license/status');

export const activateLicense = (licenseKey: string) =>
  api<{ status: string; features: Record<string, unknown> }>('/api/license/activate', {
    method: 'POST',
    body: JSON.stringify({ licenseKey }),
  });

export const provisionLicense = () =>
  api<{ status: string; features: Record<string, unknown>; instanceId: string }>(
    '/api/license/provision',
    { method: 'POST' },
  );

export const purchaseLicense = () =>
  api<{ checkoutUrl: string | null }>('/api/license/purchase', { method: 'POST' });

export const deactivateLicense = () =>
  api<void>('/api/license/deactivate', { method: 'POST' });
