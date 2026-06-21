import { api } from './api-client';

export interface Binding {
  id: string;
  instanceId: string;
  appVersion: string | null;
  publicBaseUrl: string | null;
  firstIp: string | null;
  lastIp: string | null;
  boundAt: string;
  lastHeartbeatAt: string | null;
  revokedAt: string | null;
}

export interface LicenseKeyRow {
  id: string;
  plan: 'trial' | 'paid' | string;
  expiresAt: string | null;
  expired: boolean;
  email: string | null;
  name: string | null;
  provisionedBy: string;
  revoked: boolean;
  activations: number;
  activeInstances: number;
  distinctIps: number;
  alerts: number;
  warning: boolean;
  lastIp: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  bindings: Binding[];
}

export interface WebhookKeyRow {
  id: string;
  name: string | null;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface LicenseEvent {
  id: string;
  licenseKeyId: string | null;
  instanceId: string | null;
  type: string;
  ip: string | null;
  appVersion: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export const login = (email: string, password: string) =>
  api<{ token: string; user: { email: string } }>('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const getKeys = (params: { q?: string; from?: string; to?: string } = {}) => {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  const qs = sp.toString();
  return api<{ keys: LicenseKeyRow[] }>(`/admin/keys${qs ? `?${qs}` : ''}`);
};

export const createKey = (body: {
  name?: string;
  email?: string;
  plan?: 'trial' | 'paid';
  maxActivations?: number;
}) =>
  api<{ id: string; key: string }>('/admin/keys', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const revokeKey = (id: string) =>
  api<{ ok: boolean }>(`/admin/keys/${id}/revoke`, { method: 'POST' });

export const activateKey = (id: string) =>
  api<{ ok: boolean }>(`/admin/keys/${id}/activate`, { method: 'POST' });

export const upgradeKey = (id: string) =>
  api<{ ok: boolean }>(`/admin/keys/${id}/upgrade`, { method: 'POST' });

export const getWebhookKeys = () => api<{ keys: WebhookKeyRow[] }>('/admin/webhook-keys');

export const createWebhookKey = (name?: string) =>
  api<{ id: string; key: string }>('/admin/webhook-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

export const revokeWebhookKey = (id: string) =>
  api<{ ok: boolean }>(`/admin/webhook-keys/${id}/revoke`, { method: 'POST' });

export const getEvents = (
  params: {
    before?: string;
    keyId?: string;
    type?: string;
    from?: string;
    to?: string;
    limit?: number;
  } = {},
) => {
  const q = new URLSearchParams();
  if (params.before) q.set('before', params.before);
  if (params.keyId) q.set('keyId', params.keyId);
  if (params.type) q.set('type', params.type);
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  q.set('limit', String(params.limit ?? 50));
  return api<{ events: LicenseEvent[]; nextBefore: string | null }>(`/admin/events?${q.toString()}`);
};

export const getKeyEvents = (id: string) =>
  api<{ events: LicenseEvent[] }>(`/admin/keys/${id}/events`);
