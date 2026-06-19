import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Eyebrow, Badge, Button, Field, Input } from '../components/ui';
import { getEvents, type LicenseEvent } from '../lib/admin-api';

const WARN_TYPES = new Set(['activation_blocked', 'activate_revoked', 'ip_changed']);
const ADMIN_TYPES = new Set(['admin_create', 'admin_revoke', 'admin_activate']);

const LABEL: Record<string, string> = {
  provision: 'Provisionamento',
  provision_reused: 'Provisionamento (reuso)',
  activate: 'Ativação',
  activate_revoked: 'Ativação negada (chave bloqueada)',
  activation_blocked: 'Ativação bloqueada (limite)',
  ip_changed: 'IP alterado',
  heartbeat: 'Heartbeat',
  deactivate: 'Desativação',
  admin_create: 'Admin: chave criada',
  admin_revoke: 'Admin: chave bloqueada',
  admin_activate: 'Admin: chave desbloqueada',
};

function fmtClock(ts: string) {
  return new Date(ts).toLocaleTimeString();
}
function fmtDate(ts: string) {
  return new Date(ts).toLocaleDateString();
}

export default function Events() {
  const [events, setEvents] = useState<LicenseEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const dateParams = () => ({
    from: from || undefined,
    to: to ? `${to}T23:59:59` : undefined,
  });

  function load() {
    setLoading(true);
    getEvents({ limit: 50, ...dateParams() })
      .then((r) => {
        setEvents(r.events);
        setNextBefore(r.nextBefore);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    load();
  }

  async function loadMore() {
    if (!nextBefore) return;
    const r = await getEvents({ before: nextBefore, limit: 50, ...dateParams() });
    setEvents((prev) => [...prev, ...r.events]);
    setNextBefore(r.nextBefore);
  }

  return (
    <div>
      <div className="mb-10">
        <Eyebrow>Licenças</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Eventos de acesso</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Registro de uso das chaves — apenas metadados operacionais (tipo, IP, instância, versão).
          Sem dados de conversas (LGPD).
        </p>
      </div>

      <form onSubmit={applyFilters} className="mb-6 flex flex-wrap items-end gap-3">
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
          <Search size={16} /> Filtrar
        </Button>
        {(from || to) && (
          <button
            type="button"
            onClick={() => {
              setFrom('');
              setTo('');
              setTimeout(load, 0);
            }}
            className="text-xs text-neutral-500 hover:text-white"
          >
            Limpar
          </button>
        )}
      </form>

      <div className="rounded-2xl border border-white/5 bg-[#0B0B0D]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
          <span className="ml-2 text-xs text-neutral-500">{events.length} eventos</span>
        </div>

        {loading && <div className="px-4 py-6 text-xs text-neutral-500">Carregando…</div>}
        {!loading && events.length === 0 && (
          <div className="px-4 py-6 text-xs text-neutral-500">Nenhum evento registrado.</div>
        )}

        {events.map((e) => {
          const warn = WARN_TYPES.has(e.type);
          const admin = ADMIN_TYPES.has(e.type);
          return (
            <div
              key={e.id}
              className="group flex items-start gap-4 px-4 py-3.5 border-t border-white/5 hover:bg-white/[0.025]"
            >
              <div className="shrink-0 w-[92px] tabular-nums">
                <div className="text-sm text-neutral-300">{fmtClock(e.createdAt)}</div>
                <div className="text-[11px] text-neutral-600">{fmtDate(e.createdAt)}</div>
              </div>
              <span className={warn ? 'text-amber-400' : admin ? 'text-blue-400' : 'text-emerald-400/70'}>
                {warn ? '▲' : '●'}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${warn ? 'text-amber-200' : 'text-neutral-100'}`}>
                  {LABEL[e.type] ?? e.type}
                </p>
                <p className="mt-0.5 text-[11px] font-mono text-neutral-600 truncate">
                  {[
                    e.ip ? `ip=${e.ip}` : null,
                    e.instanceId ? `instance=${e.instanceId}` : null,
                    e.appVersion ? `v${e.appVersion}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>
              </div>
              {e.licenseKeyId && (
                <Badge tone="neutral">{e.licenseKeyId.slice(0, 8)}</Badge>
              )}
            </div>
          );
        })}

        {nextBefore && (
          <div className="px-4 py-3 border-t border-white/5">
            <button onClick={loadMore} className="text-xs text-neutral-400 hover:text-white">
              Carregar mais
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
