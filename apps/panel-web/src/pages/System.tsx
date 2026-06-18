import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Badge, Button, Card, ErrorText, Eyebrow, Field, Input } from '../components/ui';
import {
  getConnections,
  getSystemInfo,
  restartSystem,
  runDiagnostics,
  saveConnections,
  type ConnectionsState,
  type Diagnostics,
  type SaveConnectionsResult,
  type SystemInfo,
} from '../lib/system-api';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-white/5 last:border-0">
      <span className="text-xs uppercase tracking-wider text-neutral-500">{label}</span>
      <span className="text-sm text-neutral-200 text-right break-all">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-[#121212] border border-white/5 rounded-xl px-4 py-3">
      <p className="text-2xl font-semibold text-white">{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-neutral-500 mt-1">{label}</p>
    </div>
  );
}

const STATUS_TONE: Record<string, 'ok' | 'neutral' | 'error'> = {
  ok: 'ok',
  active: 'ok',
  warning: 'neutral',
  grace: 'neutral',
  unactivated: 'neutral',
  unconfigured: 'neutral',
  error: 'error',
  blocked: 'error',
};

function ConnRow({ label, r }: { label: string; r?: { ok: boolean; detail?: string } }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-white/5 last:border-0">
      <span className="text-sm text-neutral-200">{label}</span>
      {r ? (
        <span className="flex items-center gap-2 min-w-0">
          {r.detail && (
            <span className="text-xs text-neutral-500 truncate max-w-[18rem]" title={r.detail}>
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

export default function System() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState('');
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  useEffect(() => {
    getSystemInfo()
      .then(setInfo)
      .catch(() => setError('Falha ao carregar informações do sistema.'));
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

  return (
    <div className="max-w-4xl">
      <div className="mb-10">
        <Eyebrow>Sistema</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Configuração</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Visão geral do que está configurado e em uso nesta instância.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!info && !error && <p className="text-sm text-neutral-500">Carregando…</p>}

      {info && (
        <div className="space-y-6">
          {/* Resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Integrações" value={info.integrations.total} />
            <Stat label="Ativas" value={info.integrations.enabled} />
            <Stat label="Contatos (diretório)" value={info.directory.contactIdentities} />
            <Stat label="Admins" value={info.app.admins} />
          </div>

          {/* Aplicação */}
          <Card>
            <h3 className="text-sm font-medium text-white mb-4">Aplicação</h3>
            <Row label="URL pública" value={info.app.publicBaseUrl} />
            <Row label="Base de webhook" value={info.app.webhookBase} />
            <Row
              label="Setup"
              value={
                <Badge tone={info.app.setupCompleted ? 'ok' : 'neutral'}>
                  {info.app.setupCompleted ? 'concluído' : 'pendente'}
                </Badge>
              }
            />
            <Row label="Ambiente" value={info.app.nodeEnv} />
          </Card>

          {/* Conexões */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-medium text-white">Conexões</h3>
                <p className="text-xs text-neutral-500 mt-1">
                  Testa Postgres, RabbitMQ e Redis de dentro do container.
                </p>
              </div>
              <Button type="button" variant="ghost" onClick={testConnections} loading={diagBusy}>
                Testar conexões
              </Button>
            </div>
            <ConnRow label="Postgres" r={diag?.postgres} />
            <ConnRow label="RabbitMQ" r={diag?.rabbitmq} />
            <ConnRow label="Redis" r={diag?.redis} />
          </Card>

          {/* Configuração de conexões (editável) */}
          <ConnectionsCard />

          {/* Licença */}
          <Card>
            <h3 className="text-sm font-medium text-white mb-4">Licença</h3>
            <Row
              label="Status"
              value={
                <Badge tone={STATUS_TONE[info.license.status] ?? 'neutral'}>
                  {info.license.status}
                </Badge>
              }
            />
            <Row label="Obrigatória" value={info.license.required ? 'sim' : 'não'} />
            {info.license.instanceId && <Row label="Instância" value={info.license.instanceId} />}
            {info.license.serverUrl && <Row label="Servidor" value={info.license.serverUrl} />}
            {info.license.lastHeartbeatAt && (
              <Row
                label="Último heartbeat"
                value={new Date(info.license.lastHeartbeatAt).toLocaleString()}
              />
            )}
          </Card>

          {/* Em uso */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white">Em uso</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(info.integrations.byProvider)
                  .filter(([, n]) => n > 0)
                  .map(([p, n]) => (
                    <Badge key={p} tone="neutral">
                      {p}: {n}
                    </Badge>
                  ))}
              </div>
            </div>
            {info.integrations.items.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhuma integração configurada.</p>
            ) : (
              <div className="space-y-2">
                {info.integrations.items.map((i) => (
                  <div
                    key={i.id}
                    className="flex items-center justify-between gap-4 bg-[#121212] border border-white/5 rounded-xl px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{i.name}</p>
                      <p className="text-xs text-neutral-500 truncate">
                        {i.providerType} · conta {i.chatwootAccountId} · inbox {i.chatwootInboxName}
                        {i.chatwootInboxId ? ` (#${i.chatwootInboxId})` : ' (não criada)'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!i.isEnabled && <Badge tone="neutral">desativada</Badge>}
                      <Badge tone={STATUS_TONE[i.status] ?? 'neutral'}>{i.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
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

function ConnectionsCard() {
  const [conn, setConn] = useState<ConnectionsState | null>(null);
  const [pg, setPg] = useState('');
  const [rb, setRb] = useState('');
  const [rd, setRd] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SaveConnectionsResult | null>(null);
  const [error, setError] = useState('');
  const [restarting, setRestarting] = useState(false);

  async function load() {
    const c = await getConnections();
    setConn(c);
    setPg(c.services.postgres.value);
    setRb(c.services.rabbitmq.value);
    setRd(c.services.redis.value);
  }

  useEffect(() => {
    load().catch(() => setError('Falha ao carregar as conexões.'));
  }, []);

  const pending = !!conn && Object.values(conn.services).some((s) => s.changed);

  async function save() {
    if (!conn) return;
    setError('');
    setRes(null);
    const body: { rabbitmqUrl?: string; redisUrl?: string; databaseUrl?: string } = {};
    if (pg !== conn.services.postgres.value) body.databaseUrl = pg;
    if (rb !== conn.services.rabbitmq.value) body.rabbitmqUrl = rb;
    if (rd !== conn.services.redis.value) body.redisUrl = rd;
    if (Object.keys(body).length === 0) {
      setError('Nenhuma alteração para salvar.');
      return;
    }
    setBusy(true);
    try {
      const r = await saveConnections(body);
      setRes(r);
      if (r.ok) await load(); // refresh "changed/pending" flags
    } catch {
      setError('Falha ao salvar/testar as conexões.');
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    setRestarting(true);
    try {
      await restartSystem();
    } catch {
      /* the server is going down — expected */
    }
    // App restarts via Swarm; reload the panel after it should be back up.
    setTimeout(() => window.location.reload(), 8000);
  }

  if (!conn) {
    return (
      <Card>
        <h3 className="text-sm font-medium text-white mb-2">Conexões (configuração)</h3>
        <p className="text-sm text-neutral-500">{error || 'Carregando…'}</p>
      </Card>
    );
  }

  const field = (
    label: string,
    svc: keyof ConnectionsState['services'],
    value: string,
    setValue: (v: string) => void,
  ) => {
    const s = conn.services[svc];
    const r = res?.results?.[svc === 'postgres' ? 'databaseUrl' : svc === 'rabbitmq' ? 'rabbitmqUrl' : 'redisUrl'];
    return (
      <div className="space-y-2">
        <Field label={label}>
          <SecretInput value={value} onChange={setValue} placeholder="connection string" />
        </Field>
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span>em uso: <code className="text-neutral-400">{s.running || '—'}</code></span>
          {s.changed && <Badge tone="neutral">alterado — pendente de reinício</Badge>}
          {!s.hotApply && <Badge tone="neutral">requer redeploy (instalador)</Badge>}
          {r && <Badge tone={r.ok ? 'ok' : 'error'}>{r.ok ? 'testado: ok' : `falhou: ${r.detail ?? ''}`}</Badge>}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <div className="mb-4">
        <h3 className="text-sm font-medium text-white">Conexões (configuração)</h3>
        <p className="text-xs text-neutral-500 mt-1">
          Edite as strings de conexão. Ao salvar, cada valor é <b>testado antes de aplicar</b>; se
          o teste falhar, nada é gravado. RabbitMQ e Redis são aplicados ao <b>reiniciar</b>; o
          Postgres exige redeploy pelo instalador.
        </p>
      </div>

      <div className="space-y-5">
        {field('Postgres (DATABASE_URL)', 'postgres', pg, setPg)}
        {field('RabbitMQ (RABBITMQ_URL)', 'rabbitmq', rb, setRb)}
        {field('Redis (REDIS_URL)', 'redis', rd, setRd)}
      </div>

      <ErrorText>{error}</ErrorText>

      {pending && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-200">
            Há alterações testadas que <b>ainda não foram aplicadas</b>. Elas entram em vigor ao
            reiniciar a aplicação.
          </p>
          <div className="flex items-center gap-4 mt-3">
            <Button type="button" onClick={restart} loading={restarting}>
              Reiniciar agora
            </Button>
            <span className="text-xs text-neutral-400">
              Ou reinicie depois — esta marcação permanece até aplicar.
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 mt-5">
        <Button type="button" onClick={save} loading={busy}>
          Salvar e testar
        </Button>
        {!pending && (
          <button
            type="button"
            onClick={restart}
            disabled={restarting}
            className="text-sm text-neutral-400 hover:text-white disabled:opacity-50"
          >
            {restarting ? 'reiniciando…' : 'Reiniciar aplicação'}
          </button>
        )}
      </div>
    </Card>
  );
}
