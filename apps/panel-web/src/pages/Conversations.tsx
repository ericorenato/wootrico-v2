import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Search, Users, User, MessageSquare } from 'lucide-react';
import { Button, Eyebrow, Field, Input } from '../components/ui';
import {
  listConversations,
  exportConversations,
  type ConversationDTO,
} from '../lib/conversations-api';
import { getLicenseStatus, type LicenseStatus } from '../lib/license-api';

const PAGE_SIZE = 50;

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function Conversations() {
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [rows, setRows] = useState<ConversationDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getLicenseStatus().then(setLicense).catch(() => {});
  }, []);

  const licensed = license ? license.status === 'active' || license.status === 'warning' : true;

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setError('');
      try {
        const res = await listConversations({
          search: query || undefined,
          from: from || undefined,
          to: to || undefined,
          page: p,
          pageSize: PAGE_SIZE,
        });
        setRows(res.conversations);
        setTotal(res.total);
        setPage(res.page);
      } catch (err) {
        const code = (err as { code?: string })?.code;
        setError(code === 'license_inactive' ? 'license_inactive' : 'Falha ao carregar as conversas.');
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [query, from, to],
  );

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (licensed) void load(1);
  }, [licensed, load]);

  async function doExport(format: 'json' | 'txt') {
    setExporting(true);
    try {
      await exportConversations(format, {
        search: query || undefined,
        from: from || undefined,
        to: to || undefined,
      });
    } catch {
      setError('Falha ao exportar.');
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <Eyebrow>Dados</Eyebrow>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Conversas</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">
            Conversas capturadas, agrupadas por conversa do Chatwoot. Por privacidade (LGPD),
            mostramos apenas o <strong className="text-neutral-300">início</strong> de cada conversa.
            A retenção é configurável em <Link to="/system" className="underline hover:text-white">Sistema</Link>.
          </p>
        </div>
        {licensed && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => doExport('json')} loading={exporting} disabled={!total}>
              <Download size={16} /> JSON
            </Button>
            <Button variant="ghost" onClick={() => doExport('txt')} loading={exporting} disabled={!total}>
              <Download size={16} /> TXT
            </Button>
          </div>
        )}
      </div>

      {!licensed ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-200">
          <p className="font-medium">Licença inativa</p>
          <p className="mt-1 text-amber-200/80">
            As conversas capturadas e a exportação só ficam disponíveis com a licença ativa. Você pode
            ajustar as configurações normalmente.{' '}
            <Link to="/license" className="underline hover:text-white">Ativar licença</Link>.
          </p>
        </div>
      ) : (
        <>
          {/* Filtros */}
          <div className="mb-5 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Field label="Buscar (nome, número ou trecho)">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ex.: João, 5521…"
                    className="pl-9"
                  />
                </div>
              </Field>
            </div>
            <Field label="De">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Até">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>

          {error && error !== 'license_inactive' && <p className="mb-4 text-sm text-red-400">{error}</p>}

          {loading ? (
            <p className="text-sm text-neutral-500">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-neutral-500">Nenhuma conversa capturada ainda.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((c) => (
                <div
                  key={c.conversationId}
                  className="rounded-xl border border-white/5 bg-[#0F0F11] p-4 hover:border-white/10 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {c.isGroup ? (
                          <Users size={13} className="text-neutral-400 shrink-0" />
                        ) : (
                          <User size={13} className="text-neutral-400 shrink-0" />
                        )}
                        <span className="text-sm font-medium text-white truncate">
                          {c.name || c.number || 'Sem nome'}
                        </span>
                        {c.isGroup && c.sender && (
                          <span className="text-xs text-neutral-500 truncate">· {c.sender}</span>
                        )}
                      </div>
                      <p className="flex items-start gap-1.5 text-sm text-neutral-300">
                        <MessageSquare size={13} className="mt-0.5 shrink-0 text-neutral-600" />
                        <span className="line-clamp-2">{c.preview || '—'}</span>
                      </p>
                    </div>
                    <div className="text-right text-[11px] text-neutral-500 shrink-0">
                      <p>{fmt(c.startedAt)}</p>
                      {c.number && !c.isGroup && <p className="font-mono">{c.number}</p>}
                      {c.integration && <p className="truncate max-w-[140px]">{c.integration}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Paginação */}
          {total > PAGE_SIZE && (
            <div className="mt-5 flex items-center justify-between text-sm text-neutral-400">
              <span>{total} conversas</span>
              <div className="flex items-center gap-3">
                <button
                  className="hover:text-white disabled:opacity-40"
                  disabled={page <= 1 || loading}
                  onClick={() => void load(page - 1)}
                >
                  Anterior
                </button>
                <span>
                  {page} / {totalPages}
                </span>
                <button
                  className="hover:text-white disabled:opacity-40"
                  disabled={page >= totalPages || loading}
                  onClick={() => void load(page + 1)}
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
