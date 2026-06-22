import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
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
  const [licName, setLicName] = useState('');
  const [licEmail, setLicEmail] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const load = () => getLicenseStatus().then(setInfo).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  // Prefill owner from the logged-in admin (editable, required for the first key).
  useEffect(() => {
    if (user?.name) setLicName((v) => v || (user.name ?? ''));
    if (user?.email) setLicEmail((v) => v || user.email);
  }, [user]);

  const serverBase = info?.serverUrl ? info.serverUrl.replace(/\/$/, '') : null;

  // Feature-detect Google login on the (vendor) license server.
  useEffect(() => {
    if (!serverBase) return;
    fetch(`${serverBase}/auth/google/config`)
      .then((r) => r.json())
      .then((d) => setGoogleEnabled(!!d.enabled))
      .catch(() => {});
  }, [serverBase]);

  async function provisionWith(name: string, email: string) {
    if (!name || !email) {
      setError('Informe nome e e-mail para ativar a licença.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await provisionLicense({ name, email });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `Falha: ${err.code}` : 'Falha ao ativar a licença.');
    } finally {
      setBusy(false);
    }
  }

  async function provision() {
    await provisionWith(licName.trim(), licEmail.trim());
  }

  function loginWithGoogle() {
    if (!serverBase) return;
    window.open(
      `${serverBase}/auth/google?origin=${encodeURIComponent(window.location.origin)}`,
      'wootrico-google',
      'width=480,height=640',
    );
  }

  // Receive the verified Google identity from the license server popup, then
  // register/activate with it.
  useEffect(() => {
    if (!serverBase) return;
    let allowed = '';
    try {
      allowed = new URL(serverBase).origin;
    } catch {
      /* ignore */
    }
    const onMsg = (e: MessageEvent) => {
      if (allowed && e.origin !== allowed) return;
      const d = e.data as { source?: string; email?: string; name?: string } | null;
      if (d && d.source === 'wootrico-google' && d.email) {
        setLicName(d.name || '');
        setLicEmail(d.email);
        void provisionWith(d.name || d.email, d.email);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBase]);

  async function buy() {
    setError('');
    setBusy(true);
    try {
      const { checkoutUrl } = await purchaseLicense();
      await load();
      if (checkoutUrl) window.open(checkoutUrl, '_blank', 'noopener');
      else setError('Solicitação registrada. Em breve entraremos em contato para concluir a compra.');
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
              Cadastre-se com o Google ou confirme seu nome e e-mail para registrar esta instância.
            </p>
            {googleEnabled && (
              <div className="mb-5">
                <GoogleButton onClick={loginWithGoogle} />
                <p className="mt-3 text-xs text-neutral-500">ou preencha manualmente:</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <Field label="Nome">
                <Input value={licName} onChange={(e) => setLicName(e.target.value)} placeholder="Seu nome" />
              </Field>
              <Field label="E-mail">
                <Input value={licEmail} onChange={(e) => setLicEmail(e.target.value)} placeholder="voce@exemplo.com" />
              </Field>
            </div>
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

        {isBlocked && (
          <>
            <h3 className="text-sm font-medium text-white mb-2">Renovar ou adquirir</h3>
            <p className="text-sm text-neutral-400 mb-5">
              Sua licença expirou. Reative gratuitamente para continuar usando, ou adquira uma
              licença definitiva.
            </p>
            {(!licName.trim() || !licEmail.trim()) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <Field label="Nome">
                  <Input value={licName} onChange={(e) => setLicName(e.target.value)} placeholder="Seu nome" />
                </Field>
                <Field label="E-mail">
                  <Input value={licEmail} onChange={(e) => setLicEmail(e.target.value)} placeholder="voce@exemplo.com" />
                </Field>
              </div>
            )}
            {googleEnabled && (
              <div className="mb-4">
                <GoogleButton onClick={loginWithGoogle} label="Reativar com Google" />
              </div>
            )}
            <ErrorText>{error}</ErrorText>
            <div className="flex flex-wrap items-center gap-4">
              <Button onClick={buy} loading={busy}>
                Adquirir licença definitiva
              </Button>
              <Button onClick={provision} variant="ghost" loading={busy}>
                Reativar gratuitamente
              </Button>
            </div>
          </>
        )}

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

/** "Sign in with Google" button (broker flow via the license server popup). */
function GoogleButton({ onClick, label = 'Entrar com Google' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-3 rounded-lg border border-white/15 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      {label}
    </button>
  );
}
