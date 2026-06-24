import { api, getToken } from './api-client';

export interface ConversationDTO {
  conversationId: string;
  name: string | null;
  number: string | null;
  sender: string | null;
  isGroup: boolean;
  direction: 'incoming' | 'outgoing';
  messageType: string;
  /** First ~200 chars of the opening message (LGPD: start only). */
  preview: string | null;
  integration: string | null;
  startedAt: string;
}

export interface ConversationsPage {
  conversations: ConversationDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export const listConversations = (
  opts: { search?: string; from?: string; to?: string; page?: number; pageSize?: number } = {},
) => {
  const p = new URLSearchParams();
  if (opts.search) p.set('search', opts.search);
  if (opts.from) p.set('from', opts.from);
  if (opts.to) p.set('to', opts.to);
  if (opts.page) p.set('page', String(opts.page));
  if (opts.pageSize) p.set('pageSize', String(opts.pageSize));
  const qs = p.toString();
  return api<ConversationsPage>(`/api/conversations${qs ? `?${qs}` : ''}`);
};

/** Download the (filtered) conversations export as JSON or TXT. */
export async function exportConversations(
  format: 'json' | 'txt',
  opts: { search?: string; from?: string; to?: string } = {},
): Promise<void> {
  const p = new URLSearchParams();
  p.set('format', format);
  if (opts.search) p.set('search', opts.search);
  if (opts.from) p.set('from', opts.from);
  if (opts.to) p.set('to', opts.to);
  const token = getToken();
  const res = await fetch(`/api/conversations/export?${p.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('export_failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `conversas-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
