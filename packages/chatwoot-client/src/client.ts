import axios, { type AxiosInstance } from 'axios';
import FormData from 'form-data';

export interface ChatwootClientConfig {
  baseUrl: string;
  apiToken: string;
  accountId: string;
}

export type ChatwootMessageType = 'incoming' | 'outgoing';
export type ChatwootConversationStatus = 'open' | 'resolved' | 'pending';

export interface AttachmentInput {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const E164 = /^\+[1-9]\d{1,14}$/;

export class ChatwootClient {
  private http: AxiosInstance;
  private accountId: string;

  constructor(config: ChatwootClientConfig) {
    this.accountId = config.accountId;
    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/$/, ''),
      headers: { api_access_token: config.apiToken },
      timeout: 30000,
    });
  }

  private acc(path: string): string {
    return `/api/v1/accounts/${this.accountId}${path}`;
  }

  // ───────────────────────── inboxes ─────────────────────────

  async listInboxes(): Promise<any[]> {
    const res = await this.http.get(this.acc('/inboxes'));
    return res.data?.payload ?? res.data?.data ?? res.data ?? [];
  }

  async getInbox(id: string | number): Promise<any | null> {
    try {
      const res = await this.http.get(this.acc(`/inboxes/${id}`));
      return res.data ?? null;
    } catch {
      return null;
    }
  }

  async createApiInbox(opts: {
    name: string;
    webhookUrl: string;
    allowMessagesAfterResolved: boolean;
  }): Promise<any> {
    const res = await this.http.post(this.acc('/inboxes'), {
      name: opts.name,
      channel: { type: 'api', webhook_url: opts.webhookUrl },
      allow_messages_after_resolved: opts.allowMessagesAfterResolved,
    });
    return res.data;
  }

  /** Returns an inbox id, creating the API inbox if needed. */
  async ensureInbox(opts: {
    name: string;
    webhookUrl: string;
    allowMessagesAfterResolved: boolean;
    knownInboxId?: string | null;
  }): Promise<string> {
    if (opts.knownInboxId) {
      const existing = await this.getInbox(opts.knownInboxId);
      if (existing?.id) return String(existing.id);
    }
    const inboxes = await this.listInboxes();
    const found = inboxes.find((i) => i?.name === opts.name);
    if (found?.id) return String(found.id);

    const created = await this.createApiInbox(opts);
    return created?.id ? String(created.id) : '';
  }

  /** Find an inbox by its exact name. */
  async findInboxByName(name: string): Promise<any | null> {
    const inboxes = await this.listInboxes();
    return inboxes.find((i) => i?.name === name) ?? null;
  }

  /** Update the webhook_url of an existing API-channel inbox. */
  async updateApiInboxWebhook(inboxId: string | number, webhookUrl: string): Promise<void> {
    await this.http.patch(this.acc(`/inboxes/${inboxId}`), {
      channel: { webhook_url: webhookUrl },
    });
  }

  /** Inspect whether an inbox with the given name exists and what channel it uses. */
  async checkInbox(
    name: string,
  ): Promise<{ exists: boolean; channelType: string | null; isApi: boolean; inboxId: string | null }> {
    const inbox = await this.findInboxByName(name);
    if (!inbox?.id) return { exists: false, channelType: null, isApi: false, inboxId: null };
    const channelType = inbox.channel_type ?? null;
    return {
      exists: true,
      channelType,
      isApi: channelType === 'Channel::Api',
      inboxId: String(inbox.id),
    };
  }

  /**
   * Reconcile the Chatwoot inbox for an integration:
   *  - existing API inbox → update its webhook_url (auto-wire);
   *  - existing non-API inbox → leave it (caller configures the webhook manually);
   *  - missing & allowed → create an API inbox with the webhook already wired.
   */
  async setupInbox(opts: {
    name: string;
    webhookUrl: string;
    createIfMissing: boolean;
    allowMessagesAfterResolved?: boolean;
    knownInboxId?: string | null;
  }): Promise<{
    inboxId: string | null;
    channelType: string | null;
    action: 'created' | 'webhook_updated' | 'manual_required' | 'not_created';
  }> {
    let inbox: any = null;
    if (opts.knownInboxId) inbox = await this.getInbox(opts.knownInboxId);
    if (!inbox?.id) inbox = await this.findInboxByName(opts.name);

    if (inbox?.id) {
      const channelType = inbox.channel_type ?? null;
      if (channelType === 'Channel::Api') {
        await this.updateApiInboxWebhook(inbox.id, opts.webhookUrl);
        return { inboxId: String(inbox.id), channelType, action: 'webhook_updated' };
      }
      return { inboxId: String(inbox.id), channelType, action: 'manual_required' };
    }

    if (opts.createIfMissing) {
      const created = await this.createApiInbox({
        name: opts.name,
        webhookUrl: opts.webhookUrl,
        allowMessagesAfterResolved: opts.allowMessagesAfterResolved ?? true,
      });
      const id = created?.id ? String(created.id) : null;
      return { inboxId: id, channelType: 'Channel::Api', action: id ? 'created' : 'not_created' };
    }
    return { inboxId: null, channelType: null, action: 'not_created' };
  }

  // ───────────────────────── contacts ─────────────────────────

  async searchContact(query: string): Promise<any[]> {
    const res = await this.http.get(this.acc('/contacts/search'), { params: { q: query } });
    return res.data?.payload ?? res.data ?? [];
  }

  async createContact(opts: {
    name: string;
    identifier: string;
    phoneNumber?: string;
  }): Promise<any> {
    const body: Record<string, unknown> = { name: opts.name, identifier: opts.identifier };
    if (opts.phoneNumber && E164.test(opts.phoneNumber)) body.phone_number = opts.phoneNumber;
    const res = await this.http.post(this.acc('/contacts'), body);
    return res.data?.payload?.contact ?? res.data?.payload ?? res.data;
  }

  async findOrCreateContact(opts: {
    name: string;
    identifier: string;
    phoneNumber?: string;
  }): Promise<any> {
    const matches = await this.searchContact(opts.identifier);
    const existing = matches.find(
      (c) =>
        c?.identifier === opts.identifier ||
        (opts.phoneNumber && c?.phone_number === opts.phoneNumber),
    );
    if (existing) return existing;
    return this.createContact(opts);
  }

  // ─────────────────────── conversations ───────────────────────

  async findConversation(opts: {
    contactId: string | number;
    inboxId: string | number;
    status: ChatwootConversationStatus;
    maxPages?: number;
  }): Promise<any | null> {
    const maxPages = opts.maxPages ?? 5;
    for (let page = 1; page <= maxPages; page++) {
      const res = await this.http.get(this.acc('/conversations'), {
        params: {
          status: opts.status,
          inbox_id: opts.inboxId,
          page,
          sort_order: 'latest_first',
        },
      });
      const list: any[] = res.data?.data?.payload ?? res.data?.payload ?? [];
      if (list.length === 0) break;
      const match = list.find((c) => String(c?.meta?.sender?.id) === String(opts.contactId));
      if (match) return match;
    }
    return null;
  }

  async createConversation(opts: {
    contactId: string | number;
    inboxId: string | number;
    status: ChatwootConversationStatus;
  }): Promise<any> {
    const res = await this.http.post(this.acc('/conversations'), {
      contact_id: opts.contactId,
      inbox_id: opts.inboxId,
      status: opts.status,
    });
    return res.data;
  }

  async reopenConversation(conversationId: string | number): Promise<void> {
    await this.http.post(this.acc(`/conversations/${conversationId}/toggle_status`), {
      status: 'open',
    });
  }

  /** Find an open conversation (optionally reopen a resolved one) or create a new one. */
  async findOrCreateConversation(opts: {
    contactId: string | number;
    inboxId: string | number;
    status: ChatwootConversationStatus;
    reopen: boolean;
  }): Promise<any> {
    const open = await this.findConversation({ ...opts, status: 'open' });
    if (open) return open;

    if (opts.reopen) {
      const resolved = await this.findConversation({ ...opts, status: 'resolved' });
      if (resolved?.id) {
        await this.reopenConversation(resolved.id);
        return resolved;
      }
    }
    return this.createConversation(opts);
  }

  // ───────────────────────── messages ─────────────────────────

  async createMessage(opts: {
    conversationId: string | number;
    content: string;
    messageType: ChatwootMessageType;
    inReplyTo?: string | number | null;
  }): Promise<any> {
    const body: Record<string, unknown> = {
      content: opts.content,
      message_type: opts.messageType,
    };
    if (opts.inReplyTo) body.content_attributes = { in_reply_to: opts.inReplyTo };
    const res = await this.http.post(
      this.acc(`/conversations/${opts.conversationId}/messages`),
      body,
    );
    return res.data;
  }

  async createMessageWithAttachment(opts: {
    conversationId: string | number;
    content: string;
    messageType: ChatwootMessageType;
    attachment: AttachmentInput;
    inReplyTo?: string | number | null;
  }): Promise<any> {
    const form = new FormData();
    if (opts.content) form.append('content', opts.content);
    form.append('message_type', opts.messageType);
    form.append('attachments[]', opts.attachment.buffer, {
      filename: opts.attachment.filename,
      contentType: opts.attachment.contentType,
    });
    if (opts.inReplyTo) {
      form.append('content_attributes', JSON.stringify({ in_reply_to: opts.inReplyTo }));
    }
    const res = await this.http.post(
      this.acc(`/conversations/${opts.conversationId}/messages`),
      form,
      { headers: form.getHeaders(), timeout: 60000 },
    );
    return res.data;
  }

  async deleteMessage(
    conversationId: string | number,
    messageId: string | number,
  ): Promise<void> {
    await this.http.delete(
      this.acc(`/conversations/${conversationId}/messages/${messageId}`),
    );
  }

  /** Lightweight connectivity check used by the panel "Test connection". */
  async testConnection(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.http.get(this.acc('/inboxes'), { timeout: 10000 });
      return { ok: true };
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? '?'}: ${err.message}`
        : (err as Error).message;
      return { ok: false, detail };
    }
  }
}
