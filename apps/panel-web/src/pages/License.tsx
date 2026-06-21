import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorText, Eyebrow, Field, Input } from '../components/ui';
import {
  activateLicense,
  provisionLicense,
  purchaseLicense,
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
  blocked: 'Bloqueada',
  unactivated: 'Não ativada',
};

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
      setError(err instanceof ApiError ? `Falha: ${err.code}` : 'Falha ao obter licença.');
    } finally {
      setBusy(false);
    }
  }

  async function buy() {
    setError('');
    setBusy(true);
    try {
      const { checkoutUrl } = await purchaseLicense();
      await load();
      if (checkoutUrl) window.open(checkoutUrl, '_blank', 'noopener');
      else
        setError(
          'Solicitação registrada. O checkout ainda não está configurado — fale com o suporte.',
        );
    } catch (err) {
      setError(err instanceof ApiError ? `Falha: ${err.code}` : 'Falha ao iniciar a compra.');
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
  const isPaid = info?.plan === 'paid';
  const isTrial = info?.plan === 'trial';
  const trialExpired = info?.status === 'blocked' && isTrial;

  return (
    <div className="max-w-2xl">
      <div className="mb-10">
        <Eyebrow>Licença</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Licença</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Obtenha um teste gratuito de 7 dias com um clique, ou adquira uma licença vitalícia. A
          licença é validada periodicamente para liberar o processamento de mensagens.
        </p>
      </div>

      {info && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-medium text-white">Status</h3>
            <div className="flex items-center gap-2">
              {info.plan && (
                <Badge tone={isPaid ? 'ok' : 'neutral'}>
                  {isPaid ? 'Vitalícia' : 'Teste gratuito'}
                </Badge>
              )}
              <Badge tone={TONE[info.status] ?? 'neutral'}>{LABEL[info.status] ?? info.status}</Badge>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-neutral-500">Titular</dt>
            <dd className="text-neutral-300 truncate">
              {user?.name ? `${user.name} · ${user.email}` : (user?.email ?? '—')}
            </dd>
            <dt className="text-neutral-500">Seu ID de instalação</dt>
            <dd className="text-neutral-300 font-mono text-xs truncate">{info.instanceId ?? '—'}</dd>
            {isTrial && (
              <>
                <dt className="text-neutral-500">Teste expira</dt>
                <dd className={trialExpired ? 'text-red-300' : 'text-neutral-300'}>
                  {info.expiresAt ? new Date(info.expiresAt).toLocaleString() : '—'}
                </dd>
              </>
            )}
            <dt className="text-neutral-500">Última validação</dt>
            <dd className="text-neutral-300">
              {info.lastValidatedAt ? new Date(info.lastValidatedAt).toLocaleString() : '—'}
            </dd>
            {info.lastError && (
              <>
                <dt className="text-neutral-500">Último erro</dt>
                <dd className="text-red-300 text-xs">{info.lastError}</dd>
              </>
            )}
          </dl>

          {info.status === 'blocked' && (
            <p className="mt-5 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {trialExpired
                ? 'Seu teste gratuito expirou. Obtenha um novo teste ou adquira uma licença vitalícia para retomar o processamento e as integrações.'
                : 'Licença inativa — processamento de mensagens pausado e integrações desabilitadas. Reative para retomar.'}
            </p>
          )}
        </Card>
      )}

      <Card>
        <h3 className="text-sm font-medium text-white mb-2">
          {activated ? 'Sua licença' : 'Obter teste gratuito'}
        </h3>
        <p className="text-sm text-neutral-400 mb-5">
          {isPaid
            ? 'Sua instância tem uma licença vitalícia ativa.'
            : isTrial
              ? 'Você está no teste gratuito. Adquira uma licença vitalícia quando quiser.'
              : 'Gera automaticamente um teste gratuito de 7 dias vinculado a esta instância.'}
        </p>
        <ErrorText>{error}</ErrorText>
        <div className="flex flex-wrap items-center gap-4">
          {!isPaid && (
            <Button onClick={buy} loading={busy}>
              Adquirir licença vitalícia
            </Button>
          )}
          {!isPaid && (
            <Button onClick={provision} variant="ghost" loading={busy}>
              {trialExpired || !activated ? 'Obter teste gratuito' : 'Renovar teste'}
            </Button>
          )}
          {activated && (
            <button
              type="button"
              onClick={deactivate}
              className="text-sm text-neutral-400 hover:text-red-300"
            >
              Desativar
            </button>
          )}
          <button
            type="button"
            onClick={() => setManual((v) => !v)}
            className="ml-auto text-xs text-neutral-500 hover:text-white"
          >
            {manual ? 'Ocultar ativação manual' : 'Tenho uma chave (ativar manualmente)'}
          </button>
        </div>

        {manual && (
          <form onSubmit={activate} className="mt-6 space-y-4 border-t border-white/5 pt-6">
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
