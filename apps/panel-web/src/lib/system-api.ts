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
