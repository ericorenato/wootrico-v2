import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Eyebrow } from '../components/ui';
import { getLogs, type LogEntry } from '../lib/system-api';

type KindFilter = 'all' | 'audit' | 'webhook';

const REFRESH_MS = 5000;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function SourceTag({ source }: { source: string }) {
  return (
    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 shrink-0">
      {source}
    </span>
  );
}

export default function Logs() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>('all');
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const apiKind = kind === 'all' ? undefined : kind;

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const page = await getLogs({ kind: apiKind, limit: 120 });
      setEntries(page.entries);
      setNextBefore(page.nextBefore);
    } catch {
      setError('Falha ao carregar os logs.');
    } finally {
      setLoading(false);
    }
  }, [apiKind]);

  // Poll only NEW entries and prepend them (live tail, keeps loaded history).
  const pollNew = useCallback(async () => {
    try {
      const page = await getLogs({ kind: apiKind, limit: 120 });
      setEntries((prev) => {
        if (!prev.length) return page.entries;
        const seen = new Set(prev.map((e) => e.id));
        const fresh = page.entries.filter((e) => !seen.has(e.id));
        return fresh.length ? [...fresh, ...prev] : prev;
      });
    } catch {
      /* transient — ignore on auto-refresh */
    }
  }, [apiKind]);

  async function loadMore() {
    if (!nextBefore) return;
    setLoading(true);
    try {
      const page = await getLogs({ kind: apiKind, before: nextBefore, limit: 120 });
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...page.entries.filter((e) => !seen.has(e.id))];
      });
      setNextBefore(page.nextBefore);
    } finally {
      setLoading(false);
    }
  }

  // Reload from scratch whenever the kind filter changes.
  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  // Auto-refresh tail.
  const pollRef = useRef(pollNew);
  pollRef.current = pollNew;
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void pollRef.current(), REFRESH_MS);
    return () => clearInterval(t);
  }, [auto]);

  const FILTERS: { key: KindFilter; label: string }[] = [
    { key: 'all', label: 'Tudo' },
    { key: 'audit', label: 'Ações' },
    { key: 'webhook', label: 'Webhooks' },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <Eyebrow>Sistema</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Logs do sistema</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Ações de administração e eventos de webhook. Por privacidade, o conteúdo das mensagens e
          mídias <b>nunca</b> é registrado — apenas os controles e eventos.
        </p>
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 bg-[#121212] border border-white/5 rounded-xl p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setKind(f.key)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                kind === f.key ? 'bg-[#1A1A1D] text-white' : 'text-neutral-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              className="accent-blue-500"
            />
            Atualização automática
          </label>
          <Button type="button" variant="ghost" onClick={loadLatest} loading={loading}>
            Atualizar
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {/* console */}
      <div className="rounded-2xl border border-white/5 bg-[#0B0B0D] font-mono text-xs">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
          <span className="ml-2 text-[11px] text-neutral-500">console — {entries.length} eventos</span>
          {auto && <span className="ml-auto text-[11px] text-emerald-400/80">● ao vivo</span>}
        </div>

        <div className="max-h-[60vh] overflow-y-auto divide-y divide-white/[0.03]">
          {entries.length === 0 && !loading ? (
            <p className="px-4 py-6 text-neutral-600">Nenhum evento registrado ainda.</p>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-4 py-2 hover:bg-white/[0.02]">
                <span className="text-neutral-600 shrink-0" title={new Date(e.at).toLocaleString()}>
                  {fmtTime(e.at)}
                </span>
                <span
                  className={`shrink-0 ${e.level === 'warn' ? 'text-amber-400' : 'text-emerald-400/70'}`}
                  title={e.level}
                >
                  {e.level === 'warn' ? '▲' : '●'}
                </span>
                <SourceTag source={e.source} />
                <span className={`flex-1 ${e.level === 'warn' ? 'text-amber-200' : 'text-neutral-200'}`}>
                  {e.summary}
                </span>
                {e.actor && (
                  <span className="text-neutral-500 shrink-0 truncate max-w-[12rem]" title={e.actor}>
                    {e.actor}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {nextBefore && (
          <div className="px-4 py-3 border-t border-white/5 text-center">
            <button
              onClick={loadMore}
              disabled={loading}
              className="text-xs text-neutral-400 hover:text-white disabled:opacity-50"
            >
              Carregar mais antigos
            </button>
          </div>
        )}
      </div>

      <div className="mt-3">
        <Badge tone="neutral">sem conteúdo de mensagens/mídia</Badge>
      </div>
    </div>
  );
}
