import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, CopyButton, ErrorText, Eyebrow, Field, Input } from '../components/ui';
import { createKey, getKeys, type LicenseKeyRow } from '../lib/admin-api';

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}

type StatusFilter = '' | 'active' | 'expired' | 'revoked';
type PlanFilter = '' | 'trial' | 'paid';

export default function Keys() {
  const [keys, setKeys] = useState<LicenseKeyRow[] | null>(null);

  // filters
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState<PlanFilter>('');
  const [status, setStatus] = useState<StatusFilter>('');

  // create form
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPlan, setNewPlan] = useState<'trial' | 'paid'>('paid');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    getKeys({
      q: q.trim() || undefined,
      plan: plan || undefined,
      status: status || undefined,
    })
      .then((r) => setKeys(r.keys))
      .catch(() => setKeys([]));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, status]);

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setCreatedKey(null);
    setBusy(true);
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
      setBusy(false);
    }
  }

  const selCls =
    'rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50';

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <Eyebrow>Licenças</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Chaves</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Busque, filtre por plano/status e clique numa chave para ver detalhes e controles.
          </p>
        </div>
        <Button onClick={() => setShowNew((v) => !v)}>
          <Plus size={16} /> Nova chave
        </Button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setKeys(null);
          load();
        }}
        className="mb-8 flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-[220px]">
          <Field label="Buscar (nome, e-mail ou chave WTR-…)">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex.: maria, WTR-…" />
          </Field>
        </div>
        <div>
          <Field label="Plano">
            <select value={plan} onChange={(e) => setPlan(e.target.value as PlanFilter)} className={selCls}>
              <option value="">Todos</option>
              <option value="trial">Teste</option>
              <option value="paid">Paga</option>
            </select>
          </Field>
        </div>
        <div>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={selCls}>
              <option value="">Todos</option>
              <option value="active">Ativa</option>
              <option value="expired">Expirada</option>
              <option value="revoked">Revogada</option>
            </select>
          </Field>
        </div>
        <Button type="submit" variant="ghost">
          <Search size={16} /> Buscar
        </Button>
      </form>

      {showNew && (
        <Card className="mb-6">
          <h3 className="text-sm font-medium text-white mb-5">Criar chave manualmente</h3>
          <form onSubmit={submitNew} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Titular (nome)">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Opcional" />
            </Field>
            <Field label="E-mail">
              <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Opcional" />
            </Field>
            <Field label="Plano">
              <select value={newPlan} onChange={(e) => setNewPlan(e.target.value as 'trial' | 'paid')} className={selCls}>
                <option value="paid">Paga (vitalícia)</option>
                <option value="trial">Inicial (14 dias)</option>
              </select>
            </Field>
            <div className="sm:col-span-3">
              <ErrorText>{error}</ErrorText>
              {createdKey && (
                <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2">
                  <span className="text-xs text-neutral-300">Chave criada (copie agora):</span>
                  <code className="text-xs text-blue-300 font-mono truncate">{createdKey}</code>
                  <CopyButton value={createdKey} className="ml-auto" />
                </div>
              )}
              <Button type="submit" loading={busy}>
                Criar chave
              </Button>
            </div>
          </form>
        </Card>
      )}

      {!keys ? (
        <p className="text-sm text-neutral-500">Carregando…</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhuma chave encontrada.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {keys.map((k) => (
            <Link key={k.id} to={`/keys/${k.id}`} className="block">
              <Card className="hover:border-white/15 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge tone={k.revoked || k.expired ? 'error' : 'ok'}>
                        {k.revoked ? 'Revogada' : k.expired ? 'Expirada' : 'Ativa'}
                      </Badge>
                      <Badge tone={k.plan === 'paid' ? 'ok' : 'neutral'}>
                        {k.plan === 'paid' ? 'Vitalícia' : 'Teste'}
                      </Badge>
                      {k.alerts > 0 && (
                        <span className="inline-flex items-center gap-1 text-red-300 text-[11px]">
                          <AlertTriangle size={12} /> {k.alerts}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-white truncate">{k.name || k.email || 'Sem titular'}</p>
                    <p className="text-xs text-neutral-500 font-mono truncate">
                      {k.id.slice(0, 8)} · {k.email ?? 'sem e-mail'}
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-neutral-500 shrink-0">
                    <p>{k.activeInstances} inst.</p>
                    <p>{k.distinctIps} IP(s)</p>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs border-t border-white/5 pt-3">
                  <dt className="text-neutral-500">Último sinal</dt>
                  <dd className="text-neutral-300">{fmt(k.lastHeartbeatAt)}</dd>
                  <dt className="text-neutral-500">Criada</dt>
                  <dd className="text-neutral-300">{new Date(k.createdAt).toLocaleDateString()}</dd>
                  {k.statusReason && (
                    <>
                      <dt className="text-neutral-500">Motivo</dt>
                      <dd className="text-amber-300">{k.statusReason}</dd>
                    </>
                  )}
                </dl>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
