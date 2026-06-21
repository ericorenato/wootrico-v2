import { useEffect, useState } from 'react';
import { Plus, Search, AlertTriangle, User, BadgeCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CopyButton,
  ErrorText,
  Eyebrow,
  Field,
  Input,
} from '../components/ui';
import {
  activateKey,
  createKey,
  getKeys,
  revokeKey,
  upgradeKey,
  type LicenseKeyRow,
} from '../lib/admin-api';

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}

interface Group {
  key: string;
  name: string | null;
  email: string | null;
  keys: LicenseKeyRow[];
}

function groupByUser(keys: LicenseKeyRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const k of keys) {
    const id = (k.email || k.name || 'sem-titular').toLowerCase();
    let g = map.get(id);
    if (!g) {
      g = { key: id, name: k.name, email: k.email, keys: [] };
      map.set(id, g);
    }
    if (!g.name && k.name) g.name = k.name;
    if (!g.email && k.email) g.email = k.email;
    g.keys.push(k);
  }
  return [...map.values()];
}

export default function Keys() {
  const [keys, setKeys] = useState<LicenseKeyRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // filters
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // create form
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPlan, setNewPlan] = useState<'trial' | 'paid'>('paid');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    getKeys({
      q: q.trim() || undefined,
      from: from || undefined,
      to: to ? `${to}T23:59:59` : undefined,
    })
      .then((r) => setKeys(r.keys))
      .catch(() => setKeys([]));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setKeys(null);
    load();
  }

  function clearFilters() {
    setQ('');
    setFrom('');
    setTo('');
    setKeys(null);
    getKeys()
      .then((r) => setKeys(r.keys))
      .catch(() => setKeys([]));
  }

  async function toggle(k: LicenseKeyRow) {
    setBusy(k.id);
    setKeys((prev) => prev?.map((x) => (x.id === k.id ? { ...x, revoked: !k.revoked } : x)) ?? prev);
    try {
      if (k.revoked) await activateKey(k.id);
      else await revokeKey(k.id);
      await load();
    } catch {
      setKeys((prev) => prev?.map((x) => (x.id === k.id ? { ...x, revoked: k.revoked } : x)) ?? prev);
      alert('Não foi possível alterar o status da chave.');
    } finally {
      setBusy(null);
    }
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setCreatedKey(null);
    setBusy('new');
    try {
      const res = await createKey({
        name: newName.trim() || undefined,
        email: newEmail.trim() || undefined,
        plan: newPlan,
      });
      setCreatedKey(res.key);
      setNewName('');
      setNewEmail('');
      await load();
    } catch {
      setError('Falha ao criar chave.');
    } finally {
      setBusy(null);
    }
  }

  async function upgrade(k: LicenseKeyRow) {
    if (!confirm('Converter esta chave de teste em licença vitalícia (paga)?')) return;
    setBusy(k.id);
    try {
      await upgradeKey(k.id);
      await load();
    } catch {
      alert('Não foi possível fazer o upgrade da chave.');
    } finally {
      setBusy(null);
    }
  }

  const groups = keys ? groupByUser(keys) : null;

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <Eyebrow>Licenças</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Chaves por usuário</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Sem bloqueio automático: cada usuário pode rodar quantas instâncias quiser. Use os avisos
            para detectar uso suspeito e, se necessário, bloqueie uma chave manualmente.
          </p>
        </div>
        <Button onClick={() => setShowNew((v) => !v)}>
          <Plus size={16} /> Nova chave
        </Button>
      </div>

      {/* filters */}
      <form onSubmit={applyFilters} className="mb-8 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <Field label="Buscar (nome, e-mail ou chave WTR-…)">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex.: maria, maria@x.com, WTR-…" />
          </Field>
        </div>
        <div className="w-40">
          <Field label="De">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Até">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" variant="ghost">
          <Search size={16} /> Buscar
        </Button>
        {(q || from || to) && (
          <button type="button" onClick={clearFilters} className="text-xs text-neutral-500 hover:text-white">
            Limpar
          </button>
        )}
      </form>

      {showNew && (
        <Card className="mb-6">
          <h3 className="text-sm font-medium text-white mb-5">Criar chave manualmente</h3>
          <form onSubmit={submitNew} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Titular (nome)">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Opcional" />
            </Field>
            <Field label="E-mail">
              <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Opcional" />
            </Field>
            <Field label="Plano">
              <select
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value as 'trial' | 'paid')}
                className="w-full rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
              >
                <option value="paid">Paga (vitalícia)</option>
                <option value="trial">Inicial (14 dias)</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <ErrorText>{error}</ErrorText>
              {createdKey && (
                <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2">
                  <span className="text-xs text-neutral-300">Chave criada (copie agora):</span>
                  <code className="text-xs text-blue-300 font-mono truncate">{createdKey}</code>
                  <CopyButton value={createdKey} className="ml-auto" />
                </div>
              )}
              <Button type="submit" loading={busy === 'new'}>
                Criar chave
              </Button>
            </div>
          </form>
        </Card>
      )}

      {!groups && <p className="text-sm text-neutral-500">Carregando…</p>}
      {groups && groups.length === 0 && <p className="text-sm text-neutral-500">Nenhuma chave encontrada.</p>}

      <div className="space-y-8">
        {groups?.map((g) => {
          const groupWarning = g.keys.some((k) => k.warning);
          const activeKeys = g.keys.filter((k) => !k.revoked).length;
          return (
            <section key={g.key}>
              <div className="flex items-center gap-3 mb-3 px-1">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/5 border border-white/10">
                  <User size={15} className="text-neutral-300" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {g.name || g.email || 'Sem titular'}
                  </p>
                  <p className="text-xs text-neutral-500 truncate">
                    {g.email ?? 'sem e-mail'} · {g.keys.length} chave(s) · {activeKeys} ativa(s)
                  </p>
                </div>
                {groupWarning && (
                  <span className="ml-auto inline-flex items-center gap-1 text-amber-400 text-xs">
                    <AlertTriangle size={14} /> uso a verificar
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {g.keys.map((k) => (
                  <Card key={k.id}>
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge tone={k.revoked ? 'error' : k.expired ? 'error' : 'ok'}>
                            {k.revoked ? 'Bloqueada' : k.expired ? 'Expirada' : 'Ativa'}
                          </Badge>
                          <Badge tone={k.plan === 'paid' ? 'ok' : 'neutral'}>
                            {k.plan === 'paid' ? 'Vitalícia' : 'Teste'}
                          </Badge>
                          {k.alerts > 0 && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/40 px-2 py-0.5 text-red-300 text-[11px]"
                              title="Acessos de IPs diferentes — possível compartilhamento"
                            >
                              <AlertTriangle size={12} /> {k.alerts} alerta(s) de IP
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-500 font-mono truncate">
                          {k.id.slice(0, 8)} ·{' '}
                          {k.provisionedBy === 'self-service'
                            ? 'autosserviço'
                            : k.provisionedBy === 'payment'
                              ? 'pagamento'
                              : 'manual'}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggle(k)}
                        disabled={busy === k.id}
                        title={k.revoked ? 'Desbloquear' : 'Bloquear'}
                        className="inline-flex items-center gap-2 disabled:opacity-50 shrink-0"
                      >
                        <span
                          className={`relative h-5 w-9 rounded-full transition-colors ${
                            k.revoked ? 'bg-neutral-600' : 'bg-blue-500'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                              k.revoked ? 'left-0.5' : 'left-[18px]'
                            }`}
                          />
                        </span>
                      </button>
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs border-t border-white/5 pt-4">
                      <dt className="text-neutral-500">Instâncias ativas</dt>
                      <dd className="text-neutral-300">{k.activeInstances}</dd>
                      <dt className="text-neutral-500">IPs distintos</dt>
                      <dd className={k.distinctIps > 1 ? 'text-amber-300' : 'text-neutral-300'}>
                        {k.distinctIps}
                      </dd>
                      {k.plan === 'trial' && (
                        <>
                          <dt className="text-neutral-500">Teste expira</dt>
                          <dd className={k.expired ? 'text-red-300' : 'text-neutral-300'}>
                            {fmt(k.expiresAt)}
                          </dd>
                        </>
                      )}
                      <dt className="text-neutral-500">Último IP</dt>
                      <dd className="text-neutral-300 font-mono">{k.lastIp ?? '—'}</dd>
                      <dt className="text-neutral-500">Último sinal</dt>
                      <dd className="text-neutral-300">{fmt(k.lastHeartbeatAt)}</dd>
                      <dt className="text-neutral-500">Criada em</dt>
                      <dd className="text-neutral-300">{fmt(k.createdAt)}</dd>
                    </dl>

                    {k.plan === 'trial' && (
                      <div className="mt-4">
                        <Button
                          variant="ghost"
                          loading={busy === k.id}
                          onClick={() => upgrade(k)}
                        >
                          <BadgeCheck size={14} /> Liberar como vitalícia
                        </Button>
                        <p className="mt-1.5 text-[11px] text-neutral-500">
                          Converte esta chave de teste em paga (vitalícia) — liberação manual, sem
                          aguardar o webhook de pagamento.
                        </p>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
