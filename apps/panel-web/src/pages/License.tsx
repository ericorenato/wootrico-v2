import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorText, Eyebrow, Field, Input } from '../components/ui';
import {
  activateLicense,
  deactivateLicense,
  getLicenseStatus,
  type LicenseStatus,
} from '../lib/license-api';
import { ApiError } from '../lib/api-client';

const TONE: Record<string, 'ok' | 'error' | 'neutral'> = {
  active: 'ok',
  warning: 'neutral',
  grace: 'neutral',
  blocked: 'error',
  unactivated: 'neutral',
};

const LABEL: Record<string, string> = {
  active: 'Ativa',
  warning: 'Atenção',
  grace: 'Carência',
  blocked: 'Bloqueada',
  unactivated: 'Não ativada',
};

export default function License() {
  const [info, setInfo] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => getLicenseStatus().then(setInfo).catch(() => {});
  useEffect(() => {
    load();
  }, []);

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

  return (
    <div className="max-w-2xl">
      <div className="mb-10">
        <Eyebrow>Licença</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Licença</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Ative sua instância com a chave adquirida. Ela é vinculada a esta instância e validada
          periodicamente.
        </p>
      </div>

      {info && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-medium text-white">Status</h3>
            <Badge tone={TONE[info.status] ?? 'neutral'}>{LABEL[info.status] ?? info.status}</Badge>
          </div>
          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-neutral-500">Instância</dt>
            <dd className="text-neutral-300 font-mono text-xs truncate">{info.instanceId ?? '—'}</dd>
            <dt className="text-neutral-500">Token expira</dt>
            <dd className="text-neutral-300">
              {info.tokenExpiresAt ? new Date(info.tokenExpiresAt).toLocaleString() : '—'}
            </dd>
            <dt className="text-neutral-500">Último sinal de atividade</dt>
            <dd className="text-neutral-300">
              {info.lastHeartbeatAt ? new Date(info.lastHeartbeatAt).toLocaleString() : '—'}
            </dd>
            {info.graceUntil && (
              <>
                <dt className="text-neutral-500">Carência até</dt>
                <dd className="text-amber-300">{new Date(info.graceUntil).toLocaleString()}</dd>
              </>
            )}
            {info.lastError && (
              <>
                <dt className="text-neutral-500">Último erro</dt>
                <dd className="text-red-300 text-xs">{info.lastError}</dd>
              </>
            )}
          </dl>

          {info.status === 'blocked' && (
            <p className="mt-5 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              Processamento de mensagens pausado. Reative a licença para retomar.
            </p>
          )}
          {info.status === 'grace' && (
            <p className="mt-5 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              Em período de carência — o sistema segue funcionando, mas reconecte ao servidor de
              licença em breve.
            </p>
          )}
        </Card>
      )}

      <Card>
        <h3 className="text-sm font-medium text-white mb-5">
          {activated ? 'Reativar / trocar chave' : 'Ativar licença'}
        </h3>
        <form onSubmit={activate} className="space-y-5">
          <Field label="Chave de licença" hint="Formato WTR-…">
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="WTR-..." required />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex items-center gap-4">
            <Button type="submit" loading={busy}>
              {activated ? 'Reativar' : 'Ativar'}
            </Button>
            {activated && (
              <button
                type="button"
                onClick={deactivate}
                className="text-sm text-neutral-400 hover:text-red-300"
              >
                Desativar
              </button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
