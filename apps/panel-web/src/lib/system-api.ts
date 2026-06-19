import { api } from './api-client';

export interface SystemInfo {
  app: {
    publicBaseUrl: string;
    webhookBase: string;
    setupCompleted: boolean;
    admins: number;
    nodeEnv: string;
  };
  license: {
    status: string;
    required?: boolean;
    instanceId?: string | null;
    serverUrl?: string | null;
    tokenExpiresAt?: string | null;
    lastHeartbeatAt?: string | null;
  };
  directory: { contactIdentities: number };
  integrations: {
    total: number;
    enabled: number;
    byProvider: Record<string, number>;
    byStatus: Record<string, number>;
    items: Array<{
      id: string;
      name: string;
      isEnabled: boolean;
      providerType: string;
      status: string;
      chatwootAccountId: string;
      chatwootInboxName: string;
      chatwootInboxId: string | null;
    }>;
  };
}

export const getSystemInfo = () => api<SystemInfo>('/api/system/info');

export interface PingResult {
  ok: boolean;
  detail?: string;
}

export interface Diagnostics {
  postgres: PingResult;
  rabbitmq: PingResult;
  redis: PingResult;
}

export const runDiagnostics = () =>
  api<Diagnostics>('/api/system/diagnostics', { method: 'POST' });

export interface ConnService {
  value: string;
  running: string;
  changed: boolean;
  hotApply: boolean;
}

export interface ConnectionsState {
  restartRequestedAt: string | null;
  services: {
    postgres: ConnService;
    rabbitmq: ConnService;
    redis: ConnService;
  };
}

export interface SaveConnectionsResult {
  ok: boolean;
  results: Record<string, { ok: boolean; detail?: string }>;
}

export const getConnections = () => api<ConnectionsState>('/api/system/connections');

export const saveConnections = (body: {
  rabbitmqUrl?: string;
  redisUrl?: string;
  databaseUrl?: string;
}) =>
  api<SaveConnectionsResult>('/api/system/connections', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const restartSystem = () =>
  api<{ ok: boolean }>('/api/system/restart', { method: 'POST' });

/** Test a single connection URL without persisting (wizard auto-test). */
export const testConnection = (service: 'postgres' | 'rabbitmq' | 'redis', url: string) =>
  api<PingResult>('/api/system/connections/test', {
    method: 'POST',
    body: JSON.stringify({ service, url }),
  });

export interface LogEntry {
  id: string;
  at: string;
  kind: 'audit' | 'webhook';
  level: 'info' | 'warn';
  source: string;
  actor: string | null;
  /** Plain-language description (pt-BR) for non-technical users. */
  title: string;
  /** Technical detail (event/source/etc) — shown small and copiable. */
  detail: string;
}

export interface LogsPage {
  entries: LogEntry[];
  nextBefore: string | null;
}

export const getLogs = (opts: { limit?: number; before?: string; kind?: 'audit' | 'webhook' } = {}) => {
  const p = new URLSearchParams();
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.before) p.set('before', opts.before);
  if (opts.kind) p.set('kind', opts.kind);
  const qs = p.toString();
  return api<LogsPage>(`/api/system/logs${qs ? `?${qs}` : ''}`);
};
