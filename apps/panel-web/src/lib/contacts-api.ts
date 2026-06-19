import { api, getToken } from './api-client';

export interface ContactDTO {
  /** Derived WhatsApp JID (phone-based, or LID address when only the LID is known). */
  jid: string | null;
  /** LID number, without the @lid suffix. */
  lid: string | null;
  /** Phone number digits, without the @s.whatsapp.net suffix. */
  pn: string | null;
  /** WhatsApp display (push) name. */
  pushName: string | null;
  /** Last profile picture URL seen (may be null/expired). */
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

export interface ContactsPage {
  contacts: ContactDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export const listContacts = (opts: { search?: string; page?: number; pageSize?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.search) p.set('search', opts.search);
  if (opts.page) p.set('page', String(opts.page));
  if (opts.pageSize) p.set('pageSize', String(opts.pageSize));
  const qs = p.toString();
  return api<ContactsPage>(`/api/contacts${qs ? `?${qs}` : ''}`);
};

/**
 * Download the full directory as CSV (honours the search filter). Uses fetch +
 * blob because the endpoint needs the Bearer token, so a plain <a href> won't do.
 */
export async function exportContacts(search?: string): Promise<void> {
  const p = new URLSearchParams();
  if (search) p.set('search', search);
  const qs = p.toString();
  const token = getToken();
  const res = await fetch(`/api/contacts/export${qs ? `?${qs}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('export_failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'contatos.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
