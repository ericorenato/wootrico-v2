import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, Check, Eye, EyeOff } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorText,
  Eyebrow,
  Field,
  Input,
  Select,
} from '../components/ui';
import {
  checkInbox,
  createIntegration,
  getIntegration,
  testChatwoot,
  testProvider,
  updateIntegration,
  type IntegrationDTO,
  type InboxResult,
} from '../lib/integrations-api';
import { ApiError } from '../lib/api-client';

type TestState = { ok?: boolean; detail?: string; busy?: boolean };

type FlowStatus = 'pending' | 'running' | 'ok' | 'info' | 'fail';
type FlowStep = { key: string; label: string; status: FlowStatus; detail?: string };

export default function IntegrationForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();

  // identity / flags
  const [name, setName] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const [providerType, setProviderType] = useState<'uazapi' | 'zapi' | 'evolution'>('uazapi');

  // provider (uazapi)
  const [uBaseUrl, setUBaseUrl] = useState('');
  const [uToken, setUToken] = useState('');
  const [uNumber, setUNumber] = useState('');
  // provider (zapi)
  const [zInstance, setZInstance] = useState('');
  const [zToken, setZToken] = useState('');
  const [zClientToken, setZClientToken] = useState('');
  // provider (evolution) — Evolution GO identifies the instance by the API key,
  // so no instance name is needed.
  const [eBaseUrl, setEBaseUrl] = useState('');
  const [eApiKey, setEApiKey] = useState('');

  // chatwoot
  const [cwBaseUrl, setCwBaseUrl] = useState('');
  const [cwToken, setCwToken] = useState('');
  const [cwAccount, setCwAccount] = useState('');
  const [cwInbox, setCwInbox] = useState('wootrico');

  // flags
  const [convStatus, setConvStatus] = useState<'open' | 'resolved' | 'pending'>('open');
  const [reabrir, setReabrir] = useState(true);
  const [desconsiderar, setDesconsiderar] = useState(true);
  const [assinar, setAssinar] = useState(true);
  const [country, setCountry] = useState('BR');

  const [loaded, setLoaded] = useState<IntegrationDTO | null>(null);
  const [cwTest, setCwTest] = useState<TestState>({});
  const [provTest, setProvTest] = useState<TestState>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // create flow: a sequence of steps shown in a loading overlay
  // (testar Chatwoot → verificar inbox → criar integração).
  const [flow, setFlow] = useState<FlowStep[] | null>(null);
  const [flowDone, setFlowDone] = useState(false);
  const [result, setResult] = useState<{
    inbox: InboxResult;
    webhookUrls: { provider: string; chatwoot: string };
  } | null>(null);

  useEffect(() => {
    if (!editing || !id) return;
    getIntegration(id).then(({ integration: it, secrets }) => {
      setLoaded(it);
      setName(it.name);
      setIsEnabled(it.isEnabled);
      setProviderType(it.providerType);
      setCwBaseUrl(it.chatwoot.baseUrl);
      setCwAccount(it.chatwoot.accountId);
      setCwInbox(it.chatwoot.inboxName);
      setConvStatus(it.flags.conversationStatus);
      setReabrir(it.flags.reabrirConversa);
      setDesconsiderar(it.flags.desconsiderarGrupo);
      setAssinar(it.flags.assinarMensagem);
      setCountry(it.flags.defaultCountry);
      // Prefill secrets + provider credentials so the form is fully editable
      // and connection tests work on edit (hidden by default, toggle to view).
      if (secrets?.chatwootApiToken) setCwToken(secrets.chatwootApiToken);
      const pc = secrets?.providerConfig;
      if (pc?.provider === 'uazapi') {
        setUBaseUrl(pc.baseUrl ?? '');
        setUToken(pc.token ?? '');
        setUNumber(pc.whatsappNumber ?? '');
      } else if (pc?.provider === 'zapi') {
        setZInstance(pc.instance ?? '');
        setZToken(pc.token ?? '');
        setZClientToken(pc.clientToken ?? '');
      } else if (pc?.provider === 'evolution') {
        setEBaseUrl(pc.baseUrl ?? '');
        setEApiKey(pc.apiKey ?? '');
      }
    });
  }, [editing, id]);

  const providerConfig = () => {
    if (providerType === 'zapi')
      return { provider: 'zapi', instance: zInstance, token: zToken, clientToken: zClientToken };
    if (providerType === 'evolution')
      return { provider: 'evolution', baseUrl: eBaseUrl, apiKey: eApiKey };
    return { provider: 'uazapi', baseUrl: uBaseUrl, token: uToken, whatsappNumber: uNumber };
  };

  const providerConfigComplete = () => {
    if (providerType === 'zapi') return !!(zInstance && zToken && zClientToken);
    if (providerType === 'evolution') return !!(eBaseUrl && eApiKey);
    return !!(uBaseUrl && uToken && uNumber);
  };

  async function runCwTest() {
    setCwTest({ busy: true });
    try {
      const r = await testChatwoot({
        chatwootBaseUrl: cwBaseUrl,
        chatwootApiToken: cwToken,
        chatwootAccountId: cwAccount,
      });
      setCwTest(r);
    } catch (e) {
      setCwTest({ ok: false, detail: (e as Error).message });
    }
  }

  async function runProvTest() {
    setProvTest({ busy: true });
    try {
      const r = await testProvider(providerConfig());
      setProvTest(r);
    } catch (e) {
      setProvTest({ ok: false, detail: (e as Error).message });
    }
  }

  // Run the guided create flow: test Chatwoot → check inbox (create-new vs
  // update-webhook) → create the integration automatically. No manual buttons.
  async function runCreateFlow() {
    const steps: FlowStep[] = [
      { key: 'chatwoot', label: 'Testando conexão com o Chatwoot', status: 'running' },
      { key: 'inbox', label: 'Verificando a caixa (inbox)', status: 'pending' },
      { key: 'create', label: 'Criando a integração', status: 'pending' },
    ];
    const set = (i: number, patch: Partial<FlowStep>) =>
      setFlow((prev) => {
        const next: FlowStep[] = (prev ?? steps).map((s) => ({ ...s }));
        next[i] = { ...next[i], ...patch } as FlowStep;
        return next;
      });
    setFlowDone(false);
    setFlow(steps.map((s) => ({ ...s })));

    // 1) Chatwoot connection
    try {
      const cw = await testChatwoot({
        chatwootBaseUrl: cwBaseUrl,
        chatwootApiToken: cwToken,
        chatwootAccountId: cwAccount,
      });
      if (!cw.ok) {
        set(0, { status: 'fail', detail: cw.detail ?? 'conexão recusada' });
        setFlowDone(true);
        return;
      }
      set(0, { status: 'ok', detail: 'conectado' });
    } catch (e) {
      set(0, { status: 'fail', detail: (e as Error).message });
      setFlowDone(true);
      return;
    }

    // 2) Inbox check — tell the user what will happen
    set(1, { status: 'running' });
    try {
      const chk = await checkInbox({
        chatwootBaseUrl: cwBaseUrl,
        chatwootApiToken: cwToken,
        chatwootAccountId: cwAccount,
        chatwootInboxName: cwInbox,
      });
      if (!chk.exists) {
        set(1, { status: 'info', detail: 'Não existe — uma nova caixa (canal API) será criada.' });
      } else if (chk.isApi) {
        set(1, { status: 'ok', detail: 'Já existe (canal API) — o webhook será atualizado.' });
      } else {
        set(1, {
          status: 'info',
          detail: `Já existe (canal ${chk.channelType ?? '?'}) — o webhook precisará ser configurado manualmente.`,
        });
      }
    } catch (e) {
      // Non-fatal: creation still proceeds (createIfMissing handles it).
      set(1, { status: 'info', detail: `Não foi possível verificar (${(e as Error).message}).` });
    }

    // 3) Create the integration (always create the inbox if missing)
    set(2, { status: 'running' });
    try {
      const saved = await createIntegration({
        name,
        isEnabled,
        providerType,
        providerConfig: providerConfig(),
        chatwootBaseUrl: cwBaseUrl,
        chatwootApiToken: cwToken,
        chatwootAccountId: cwAccount,
        chatwootInboxName: cwInbox,
        conversationStatus: convStatus,
        reabrirConversa: reabrir,
        desconsiderarGrupo: desconsiderar,
        assinarMensagem: assinar,
        defaultCountry: country,
        createInboxIfMissing: true,
      });
      set(2, { status: 'ok', detail: 'integração criada' });
      setFlowDone(true);
      setResult({ inbox: saved.inbox, webhookUrls: saved.integration.webhookUrls });
    } catch (err) {
      const msg = err instanceof ApiError ? `Erro: ${err.code}` : 'Falha ao criar.';
      set(2, { status: 'fail', detail: msg });
      setFlowDone(true);
    }
  }

  function validate(): string | null {
    const missing: string[] = [];
    if (!name.trim()) missing.push('Nome');
    if (!cwBaseUrl.trim()) missing.push('Chatwoot Base URL');
    if (!cwAccount.trim()) missing.push('Account ID');
    if (!cwInbox.trim()) missing.push('Nome do Inbox');
    // On create the Chatwoot token and provider credentials are required; on edit
    // blank fields mean "keep the stored value".
    if (!editing) {
      if (!cwToken.trim()) missing.push('Chatwoot API Token');
      if (!providerConfigComplete()) missing.push(`Credenciais do provider (${providerType})`);
    }
    return missing.length ? `Preencha os campos obrigatórios: ${missing.join(', ')}.` : null;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    // On CREATE: run the guided flow (testa Chatwoot → verifica inbox → cria).
    if (!editing || !id) {
      await runCreateFlow();
      return;
    }

    // On EDIT: update in place and re-reconcile the inbox/webhook.
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name,
        isEnabled,
        chatwootBaseUrl: cwBaseUrl,
        chatwootAccountId: cwAccount,
        chatwootInboxName: cwInbox,
        conversationStatus: convStatus,
        reabrirConversa: reabrir,
        desconsiderarGrupo: desconsiderar,
        assinarMensagem: assinar,
        defaultCountry: country,
        createInboxIfMissing: true,
      };
      if (cwToken) body.chatwootApiToken = cwToken;
      if (providerConfigComplete()) {
        body.providerType = providerType;
        body.providerConfig = providerConfig();
      }
      const saved = await updateIntegration(id, body);
      setResult({ inbox: saved.inbox, webhookUrls: saved.integration.webhookUrls });
    } catch (err) {
      if (err instanceof ApiError) setError(`Erro: ${err.code}`);
      else setError('Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-10">
        <Eyebrow>Integrações</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">
          {editing ? 'Editar integração' : 'Nova integração'}
        </h1>
      </div>

      <form onSubmit={save} className="space-y-6">
        <Card>
          <h3 className="text-sm font-medium text-white mb-5">Geral</h3>
          <div className="space-y-4">
            <Field label="Nome">
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Provider">
              <Select
                value={providerType}
                onChange={(e) => setProviderType(e.target.value as 'uazapi' | 'zapi' | 'evolution')}
              >
                <option value="uazapi">uazapi</option>
                <option value="zapi">zapi</option>
                <option value="evolution">evolution-go</option>
              </Select>
            </Field>
            <Checkbox label="Ativada" checked={isEnabled} onChange={setIsEnabled} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-medium text-white">Provider · {providerType}</h3>
            <div className="flex items-center gap-3">
              {provTest.ok !== undefined && (
                <Badge tone={provTest.ok ? 'ok' : 'error'}>
                  {provTest.ok ? 'conectado' : provTest.detail ?? 'falhou'}
                </Badge>
              )}
              <Button type="button" variant="ghost" onClick={runProvTest} loading={provTest.busy}>
                Testar
              </Button>
            </div>
          </div>
          <div className="space-y-4">
            {providerType === 'uazapi' && (
              <>
                <Field label="Base URL">
                  <Input value={uBaseUrl} onChange={(e) => setUBaseUrl(e.target.value)} placeholder="https://sua.uazapi.com" />
                </Field>
                <Field label="Token">
                  <SecretInput value={uToken} onChange={setUToken} />
                </Field>
                <Field label="Número do WhatsApp" hint="Somente dígitos (com DDI).">
                  <Input value={uNumber} onChange={(e) => setUNumber(e.target.value)} placeholder="5541999999999" />
                </Field>
              </>
            )}
            {providerType === 'zapi' && (
              <>
                <Field label="Instância">
                  <Input value={zInstance} onChange={(e) => setZInstance(e.target.value)} />
                </Field>
                <Field label="Token da instância">
                  <SecretInput value={zToken} onChange={setZToken} />
                </Field>
                <Field label="Client-Token">
                  <SecretInput value={zClientToken} onChange={setZClientToken} />
                </Field>
              </>
            )}
            {providerType === 'evolution' && (
              <>
                <Field label="Base URL">
                  <Input value={eBaseUrl} onChange={(e) => setEBaseUrl(e.target.value)} placeholder="https://sua.evolution.com" />
                </Field>
                <Field label="API Key">
                  <SecretInput value={eApiKey} onChange={setEApiKey} />
                </Field>
              </>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-medium text-white">Chatwoot</h3>
            <div className="flex items-center gap-3">
              {cwTest.ok !== undefined && (
                <Badge tone={cwTest.ok ? 'ok' : 'error'}>
                  {cwTest.ok ? 'conectado' : cwTest.detail ?? 'falhou'}
                </Badge>
              )}
              <Button type="button" variant="ghost" onClick={runCwTest} loading={cwTest.busy}>
                Testar
              </Button>
            </div>
          </div>
          <div className="space-y-4">
            <Field label="Base URL">
              <Input value={cwBaseUrl} onChange={(e) => setCwBaseUrl(e.target.value)} placeholder="https://chat.seudominio.com" />
            </Field>
            <Field label="API Token">
              <SecretInput value={cwToken} onChange={setCwToken} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Account ID">
                <Input value={cwAccount} onChange={(e) => setCwAccount(e.target.value)} placeholder="1" />
              </Field>
              <Field label="Nome do Inbox">
                <Input value={cwInbox} onChange={(e) => setCwInbox(e.target.value)} placeholder="WhatsApp" />
              </Field>
            </div>
            <p className="text-xs text-neutral-500 pt-1">
              Ao criar, o sistema verifica a caixa automaticamente: se não existir, cria uma nova
              (canal API); se já existir, atualiza o webhook.
            </p>
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-medium text-white mb-5">Comportamento</h3>
          <div className="space-y-4">
            <Field label="Status inicial da conversa">
              <Select value={convStatus} onChange={(e) => setConvStatus(e.target.value as any)}>
                <option value="open">open</option>
                <option value="pending">pending</option>
                <option value="resolved">resolved</option>
              </Select>
            </Field>
            <Field label="País padrão (ISO-2)">
              <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} />
            </Field>
            <Checkbox label="Reabrir conversas resolvidas" checked={reabrir} onChange={setReabrir} />
            <Checkbox label="Desconsiderar grupos" checked={desconsiderar} onChange={setDesconsiderar} />
            <Checkbox label="Assinar mensagens com nome do agente" checked={assinar} onChange={setAssinar} />
          </div>
        </Card>

        {result ? (
          <>
            <InboxResultCard inbox={result.inbox} urls={result.webhookUrls} />
            <div className="flex items-center gap-4">
              <Button type="button" onClick={() => navigate('/integrations')}>
                Concluir
              </Button>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="text-sm text-neutral-400 hover:text-white"
              >
                Continuar editando
              </button>
            </div>
          </>
        ) : (
          <>
            {editing && loaded && <WebhookUrls urls={loaded.webhookUrls} />}

            <ErrorText>{error}</ErrorText>

            <div className="flex items-center gap-4">
              <Button type="submit" loading={saving || (!!flow && !flowDone)}>
                {editing ? 'Salvar' : 'Criar integração'}
              </Button>
              <button
                type="button"
                onClick={() => navigate('/integrations')}
                className="text-sm text-neutral-400 hover:text-white"
              >
                Cancelar
              </button>
            </div>
          </>
        )}
      </form>

      {flow && !result && (
        <FlowOverlay
          steps={flow}
          done={flowDone}
          onClose={() => {
            setFlow(null);
            setFlowDone(false);
          }}
          onRetry={() => runCreateFlow()}
        />
      )}
    </div>
  );
}

const FLOW_ICON: Record<FlowStatus, { ch: string; cls: string; spin?: boolean }> = {
  pending: { ch: '○', cls: 'text-neutral-600' },
  running: { ch: '◐', cls: 'text-blue-400', spin: true },
  ok: { ch: '✓', cls: 'text-emerald-400' },
  info: { ch: 'ℹ', cls: 'text-blue-300' },
  fail: { ch: '✕', cls: 'text-red-400' },
};

function FlowOverlay({
  steps,
  done,
  onClose,
  onRetry,
}: {
  steps: FlowStep[];
  done: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const failed = steps.some((s) => s.status === 'fail');
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-6">
      <div className="w-full max-w-md bg-[#161618] border border-white/10 rounded-2xl p-6 shadow-2xl">
        <h3 className="text-sm font-medium text-white mb-5">Criando integração</h3>
        <ul className="space-y-4">
          {steps.map((s) => {
            const ic = FLOW_ICON[s.status];
            return (
              <li key={s.key} className="flex items-start gap-3">
                <span className={`mt-0.5 text-base leading-none ${ic.cls} ${ic.spin ? 'animate-spin' : ''}`}>
                  {ic.ch}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-neutral-200">{s.label}</p>
                  {s.detail && <p className="text-xs text-neutral-500 mt-0.5">{s.detail}</p>}
                </div>
              </li>
            );
          })}
        </ul>
        {done && (
          <div className="flex items-center gap-4 mt-6">
            {failed ? (
              <>
                <Button type="button" onClick={onRetry}>
                  Tentar novamente
                </Button>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-sm text-neutral-400 hover:text-white"
                >
                  Fechar
                </button>
              </>
            ) : (
              <p className="text-xs text-neutral-500">Concluído.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Secret field: hidden by default, with an eye toggle to reveal/edit. */
function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-12"
        autoComplete="off"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white transition-colors"
        title={show ? 'Ocultar' : 'Mostrar'}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function inboxMessage(action: InboxResult['action']): { tone: 'ok' | 'neutral' | 'error'; text: string } {
  switch (action) {
    case 'created':
      return { tone: 'ok', text: 'Inbox criada no Chatwoot e webhook configurado automaticamente.' };
    case 'webhook_updated':
      return { tone: 'ok', text: 'A inbox já existia (canal API) — o webhook foi atualizado automaticamente.' };
    case 'unchanged':
      return { tone: 'ok', text: 'Configuração salva.' };
    case 'manual_required':
      return {
        tone: 'neutral',
        text: 'A inbox existe, mas não é um canal API. Configure o webhook manualmente no Chatwoot usando a URL abaixo.',
      };
    case 'not_created':
      return {
        tone: 'neutral',
        text: 'A inbox não existe e a criação automática está desligada. Ligue a opção e salve novamente, ou crie a inbox manualmente.',
      };
    default:
      return { tone: 'error', text: 'Não foi possível configurar a inbox automaticamente.' };
  }
}

function InboxResultCard({
  inbox,
  urls,
}: {
  inbox: InboxResult;
  urls: { provider: string; chatwoot: string };
}) {
  const m = inboxMessage(inbox.action);
  return (
    <Card>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-medium text-white">Inbox & webhook</h3>
        <Badge tone={m.tone}>{inbox.action}</Badge>
      </div>
      <p className="text-sm text-neutral-300 mb-4">
        {m.text}
        {inbox.error ? ` (${inbox.error})` : ''}
      </p>
      <div className="space-y-3">
        <CopyRow label="Provider" value={urls.provider} />
        <CopyRow label="Chatwoot" value={urls.chatwoot} />
      </div>
    </Card>
  );
}

function WebhookUrls({ urls }: { urls: { provider: string; chatwoot: string } }) {
  return (
    <Card>
      <h3 className="text-sm font-medium text-white mb-1">URLs de webhook</h3>
      <p className="text-xs text-neutral-500 mb-5">
        Cole a URL "provider" na sua API não-oficial. A URL do Chatwoot é configurada
        automaticamente no inbox.
      </p>
      <div className="space-y-3">
        <CopyRow label="Provider" value={urls.provider} />
        <CopyRow label="Chatwoot" value={urls.chatwoot} />
      </div>
    </Card>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-500 mb-2">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-[#121212] border border-white/5 rounded-xl px-4 py-2.5 text-xs text-neutral-300 overflow-x-auto">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="w-10 h-10 rounded-xl bg-[#1A1A1D] border border-white/5 flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
        >
          {copied ? <Check size={16} className="text-blue-400" /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  );
}
