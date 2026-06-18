import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Eyebrow } from '../components/ui';
import { api } from '../lib/api-client';
import { listIntegrations, type IntegrationDTO } from '../lib/integrations-api';
import { getLicenseStatus, type LicenseStatus } from '../lib/license-api';

interface Health {
  status: string;
  db: boolean;
}

const LIC_TONE: Record<string, 'ok' | 'error' | 'neutral'> = {
  active: 'ok',
  warning: 'neutral',
  grace: 'neutral',
  blocked: 'error',
  unactivated: 'neutral',
};

const LIC_LABEL: Record<string, string> = {
  active: 'Ativa',
  warning: 'Atenção',
  grace: 'Carência',
  blocked: 'Bloqueada',
  unactivated: 'Não ativada',
  unknown: 'Desconhecida',
};

export default function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationDTO[] | null>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    api<Health>('/api/health').then(setHealth).catch(() => {});
    listIntegrations().then(setIntegrations).catch(() => setIntegrations([]));
    getLicenseStatus().then(setLicense).catch(() => {});
  }, []);

  const enabled = integrations?.filter((i) => i.isEnabled).length ?? 0;
  const errored = integrations?.filter((i) => i.status === 'error').length ?? 0;

  return (
    <div>
      <div className="mb-10">
        <Eyebrow>Início</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Visão geral</h1>
        <p className="mt-2 text-sm text-neutral-400">Estado da sua instância.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-2 h-2 rounded-full ${health?.db ? 'bg-blue-500' : 'bg-red-500'}`} />
            <span className="text-xs text-neutral-400">Banco de dados</span>
          </div>
          <p className="text-3xl font-semibold text-white tracking-tight">
            {health ? (health.db ? 'OK' : 'Falha') : '…'}
          </p>
          <p className="text-[10px] text-neutral-500 mt-1">Postgres</p>
        </Card>

        <Link to="/integrations">
          <Card className="hover:border-blue-500/25 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-xs text-neutral-400">Integrações ativas</span>
            </div>
            <p className="text-3xl font-semibold text-white tracking-tight">
              {integrations === null ? '…' : enabled}
            </p>
            <p className="text-[10px] text-neutral-500 mt-1">
              {integrations === null ? '' : `${integrations.length} no total`}
              {errored > 0 ? ` · ${errored} com erro` : ''}
            </p>
          </Card>
        </Link>

        <Link to="/license">
          <Card className="hover:border-blue-500/25 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-xs text-neutral-400">Licença</span>
              </div>
              {license && (
                <Badge tone={LIC_TONE[license.status] ?? 'neutral'}>
                  {LIC_LABEL[license.status] ?? license.status}
                </Badge>
              )}
            </div>
            <p className="text-3xl font-semibold text-white tracking-tight">
              {license ? (LIC_LABEL[license.status] ?? license.status) : '…'}
            </p>
            <p className="text-[10px] text-neutral-500 mt-1">
              {license?.tokenExpiresAt
                ? `expira ${new Date(license.tokenExpiresAt).toLocaleDateString()}`
                : 'não ativada'}
            </p>
          </Card>
        </Link>
      </div>

      {integrations && integrations.length === 0 && (
        <Card>
          <p className="text-sm text-neutral-400">
            Nenhuma integração ainda.{' '}
            <Link to="/integrations/new" className="text-blue-400 hover:underline">
              Criar a primeira →
            </Link>
          </p>
        </Card>
      )}
    </div>
  );
}
