import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Check, Globe, KeyRound, Plug, Activity } from 'lucide-react';
import { Badge, Button, Card, ErrorText, Eyebrow, Field, Input } from '../components/ui';
import { completeSetup, setBaseUrl } from '../lib/setup-api';
import { activateLicense, getLicenseStatus, type LicenseStatus } from '../lib/license-api';
import { runDiagnostics, type Diagnostics } from '../lib/system-api';
import ConnectionsEditor from '../components/ConnectionsEditor';
import { ApiError } from '../lib/api-client';

const STEPS = ['Conexões', 'URL pública', 'Licença', 'Integração'] as const;

export default function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // step 0 — connection diagnostics
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  // step 1 — public URL
  const [baseUrl, setBaseUrlValue] = useState(window.location.origin);
  // step 2 — license
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step === 2) getLicenseStatus().then(setLicense).catch(() => {});
  }, [step]);

  // Auto-run the connection test when landing on the first step.
  useEffect(() => {
    testConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function testConnections() {
    setDiagBusy(true);
    try {
      setDiag(await runDiagnostics());
    } catch {
      setDiag({
        postgres: { ok: false, detail: 'falha na requisição' },
        rabbitmq: { ok: false, detail: 'falha na requisição' },
        redis: { ok: false, detail: 'falha na requisição' },
      });
    } finally {
      setDiagBusy(false);
    }
  }

  async function saveBaseUrl() {
    setError('');
    setBusy(true);
    try {
      await setBaseUrl(baseUrl.trim());
      setStep(2);
    } catch {
      setError('URL inválida.');
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    setError('');
    setBusy(true);
    try {
      await activateLicense(key.trim());
      const st = await getLicenseStatus();
      setLicense(st);
      setStep(3);
    } catch (e) {
      setError(e instanceof ApiError ? `Falha: ${e.code}` : 'Falha ao ativar.');
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    await completeSetup();
    navigate('/');
  }

  return (
    <div className="min-h-screen bg-black relative flex items-center justify-center px-6 py-12 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/50 to-black" />
        <div className="absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2">
          <div className="w-[40rem] h-[40rem] rounded-full bg-blue-600/20 blur-[120px] mix-blend-screen" />
        </div>
      </div>

      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <Eyebrow>Configuração inicial</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Bem-vindo ao Wootrico</h1>
          <p className="mt-2 text-sm text-neutral-400">Três passos rápidos para começar.</p>
        </div>

        {/* stepper */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span
                className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium border ${
                  i < step
                    ? 'bg-blue-500 text-white border-blue-500'
                    : i === step
                      ? 'bg-white/10 text-white border-white/40'
                      : 'bg-transparent text-neutral-500 border-white/10'
                }`}
              >
                {i < step ? <Check size={14} /> : i + 1}
              </span>
              <span className={`text-xs ${i === step ? 'text-white' : 'text-neutral-500'}`}>{label}</span>
              {i < STEPS.length - 1 && <span className="w-6 h-px bg-white/10" />}
            </div>
          ))}
        </div>

        <Card>
          {step === 0 && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-white">
                <Activity size={16} className="text-blue-400" />
                <h3 className="text-sm font-medium">Testar conexões</h3>
              </div>
              <p className="text-sm text-neutral-400">
                Valida Postgres, RabbitMQ e Redis de dentro do container antes de prosseguir.
              </p>
              <div className="rounded-xl border border-white/5 bg-[#121212] divide-y divide-white/5">
                <DiagLine label="Postgres" r={diag?.postgres} busy={diagBusy} />
                <DiagLine label="RabbitMQ" r={diag?.rabbitmq} busy={diagBusy} />
                <DiagLine label="Redis" r={diag?.redis} busy={diagBusy} />
              </div>

              <p className="text-xs text-neutral-500">
                Alguma conexão falhou? Ajuste abaixo (ex.: o <b>VHost</b> do RabbitMQ — o padrão é{' '}
                <code>/</code>), salve para testar e reinicie para aplicar.
              </p>
              <ConnectionsEditor heading={false} />

              <div className="flex items-center gap-4">
                <Button onClick={() => setStep(1)} loading={diagBusy}>
                  Continuar
                </Button>
                <button
                  onClick={testConnections}
                  className="text-sm text-neutral-400 hover:text-white"
                >
                  Testar novamente
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-white">
                <Globe size={16} className="text-blue-400" />
                <h3 className="text-sm font-medium">URL pública desta instância</h3>
              </div>
              <p className="text-sm text-neutral-400">
                Usada para montar as URLs de webhook que você colará no Chatwoot e na API.
              </p>
              <Field label="Base URL">
                <Input value={baseUrl} onChange={(e) => setBaseUrlValue(e.target.value)} />
              </Field>
              <ErrorText>{error}</ErrorText>
              <Button onClick={saveBaseUrl} loading={busy}>
                Continuar
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-white">
                <KeyRound size={16} className="text-blue-400" />
                <h3 className="text-sm font-medium">Ativar licença</h3>
                {license && (
                  <Badge tone={license.status === 'active' ? 'ok' : 'neutral'}>{license.status}</Badge>
                )}
              </div>
              <p className="text-sm text-neutral-400">Informe a chave adquirida (formato WTR-…).</p>
              <Field label="Chave de licença">
                <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="WTR-..." />
              </Field>
              <ErrorText>{error}</ErrorText>
              <div className="flex items-center gap-4">
                <Button onClick={activate} loading={busy}>
                  Ativar
                </Button>
                <button onClick={() => setStep(3)} className="text-sm text-neutral-400 hover:text-white">
                  Pular por enquanto
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-white">
                <Plug size={16} className="text-blue-400" />
                <h3 className="text-sm font-medium">Primeira integração</h3>
              </div>
              <p className="text-sm text-neutral-400">
                Crie uma integração ligando uma conta/inbox do Chatwoot a uma API não-oficial. Você
                poderá testar a conexão e copiar as URLs de webhook na própria tela.
              </p>
              <div className="flex items-center gap-4">
                <Link to="/integrations/new">
                  <Button>Criar integração</Button>
                </Link>
                <button onClick={finish} className="text-sm text-neutral-400 hover:text-white">
                  Concluir e ir ao painel
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function DiagLine({
  label,
  r,
  busy,
}: {
  label: string;
  r?: { ok: boolean; detail?: string };
  busy: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm text-neutral-200">{label}</span>
      {busy && !r ? (
        <span className="text-xs text-neutral-500">testando…</span>
      ) : r ? (
        <span className="flex items-center gap-2 min-w-0">
          {r.detail && (
            <span className="text-xs text-neutral-500 truncate max-w-[14rem]" title={r.detail}>
              {r.detail}
            </span>
          )}
          <Badge tone={r.ok ? 'ok' : 'error'}>{r.ok ? 'ok' : 'falhou'}</Badge>
        </span>
      ) : (
        <span className="text-xs text-neutral-600">—</span>
      )}
    </div>
  );
}
