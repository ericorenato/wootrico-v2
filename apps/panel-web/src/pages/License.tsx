import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, ErrorText, Eyebrow, Field, Input } from '../components/ui';
import {
  activateLicense,
  provisionLicense,
  deactivateLicense,
  getLicenseStatus,
  type LicenseStatus,
} from '../lib/license-api';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api-client';

const TONE: Record<string, 'ok' | 'error' | 'neutral'> = {
  active: 'ok',
  warning: 'neutral',
  blocked: 'error',
  unactivated: 'neutral',
};

const LABEL: Record<string, string> = {
  active: 'Ativa',
  warning: 'Atenção',
  blocked: 'Expirada',
  unactivated: 'Não ativada',
};

/** Whole days remaining until the given ISO date (0 when past). */
function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export default function License() {
  const { user } = useAuth();
  const [info, setInfo] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState(false);

  const load = () => getLicenseStatus().then(setInfo).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function provision() {
    setError('');
    setBusy(true);
    try {
      await provisionLicense();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `Falha: ${err.code}` : 'Falha ao ativar a licença.');
    } finally {
      setBusy(false);
    }
  }

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await activateLicense(key.trim());
      setKey('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `Falha: ${err.code}` : 'Falha ao ativar.');
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!confirm('Desativar a licença nesta instância? (libera a chave para outra instância)')) return;
    setBusy(true);
    await deactivateLicense().catch(() => {});
    await load();
    setBusy(false);
  }

  const activated = info && info.status !== 'unactivated';
  const isActive = info?.status === 'active' || info?.status === 'warning';
  const isBlocked = info?.status === 'blocked';
  const remaining = isActive ? daysLeft(info?.expiresAt ?? null) : null;

  return (
    <div className="max-w-2xl">
      <div className="mb-10">
        <Eyebrow>Licença</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Licença</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Gerencie a licença desta instância do Wootrico.
        </p>
      </div>

      {info && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-medium text-white">Status</h3>
            <Badge tone={TONE[info.status] ?? 'neutral'}>{LABEL[info.status] ?? info.status}</Badge>
          </div>

          {/* Dias restantes (quando ativa e há prazo). Sem detalhar a renovação. */}
          {isActive && remaining !== null && (
            <div className="mb-5 rounded-lg border border-white/5 bg-white/[0.03] px-4 py-3">
              <p className="text-2xl font-semibold text-white">
                {remaining} {remaining === 1 ? 'dia restante' : 'dias restantes'}
              </p>
            </div>
          )}

          {/* Banner de licença expirada. */}
          {isBlocked && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-300" />
              <div className="text-sm">
                <p className="font-medium text-red-200">Licença expirada</p>
                <p className="text-red-200/80">
                  O processamento de mensagens está pausado e as integrações foram desativadas.
                  Seus dados continuam acessíveis.
                </p>
              </div>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-neutral-500">Titular</dt>
            <dd className="text-neutral-300 truncate">
              {user?.name ? `${user.name} · ${user.email}` : (user?.email ?? '—')}
            </dd>
            <dt className="text-neutral-500">Seu ID de instalação</dt>
            <dd className="text-neutral-300 font-mono text-xs truncate">{info.instanceId ?? '—'}</dd>
            <dt className="text-neutral-500">Última validação</dt>
            <dd className="text-neutral-300">
              {info.lastValidatedAt ? new Date(info.lastValidatedAt).toLocaleString() : '—'}
            </dd>
          </dl>
        </Card>
      )}

      <Card>
        {!activated && (
          <>
            <h3 className="text-sm font-medium text-white mb-2">Ativar</h3>
            <p className="text-sm text-neutral-400 mb-5">
              Ative o Wootrico para esta instância e comece a usar.
            </p>
            <ErrorText>{error}</ErrorText>
            <Button onClick={provision} loading={busy}>
              Ativar
            </Button>
          </>
        )}

        {activated && isActive && (
          <>
            <h3 className="text-sm font-medium text-white mb-2">Licença ativa</h3>
            <p className="text-sm text-neutral-400 mb-5">
              Sua instância está ativa e funcionando normalmente.
            </p>
            <ErrorText>{error}</ErrorText>
            <button
              type="button"
              onClick={deactivate}
              className="text-sm text-neutral-400 hover:text-red-300"
            >
              Desativar nesta instância
            </button>
          </>
        )}

        {isBlocked && <ErrorText>{error}</ErrorText>}

        <button
          type="button"
          onClick={() => setManual((v) => !v)}
          className="mt-6 block text-xs text-neutral-500 hover:text-white"
        >
          {manual ? 'Ocultar ativação manual' : 'Tenho uma chave (ativar manualmente)'}
        </button>

        {manual && (
          <form onSubmit={activate} className="mt-4 space-y-4 border-t border-white/5 pt-6">
            <Field label="Chave de licença" hint="Formato WTR-…">
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="WTR-..."
                required
              />
            </Field>
            <Button type="submit" variant="ghost" loading={busy}>
              Ativar chave
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
