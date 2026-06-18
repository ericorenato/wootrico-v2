import axios, { type AxiosInstance } from 'axios';
import type {
  EvolutionConfig,
  NormalizedInboundMessage,
  SendMessageInput,
  SendMessageResult,
} from '@wootrico/types';
import type {
  DownloadResult,
  MediaRef,
  ParseContext,
  TestResult,
  WhatsAppProvider,
} from '../provider.interface.js';
import { urlToBase64 } from '../util/media.js';
import { parseEvolutionInbound } from './parse-inbound.js';

/**
 * Provider for **Evolution GO** (github.com/EvolutionAPI/evolution-go, whatsmeow).
 *
 * NOTE: Evolution GO's HTTP API differs from the classic Evolution API:
 *  - the `apikey` header identifies the instance (no `/{instance}` path segment);
 *  - send routes are `/send/text` and `/send/media` (with `type` in the body);
 *  - connection state is `GET /instance/status`.
 * Responses are wrapped as `{ data: <payload>, message: "success" }`.
 */

/** Strip a data: URL prefix — keep only the raw base64. */
function pureBase64(value: string): string {
  const idx = value.indexOf('base64,');
  return idx >= 0 ? value.slice(idx + 'base64,'.length) : value;
}

/** Build a data: URL when we only have raw base64 (Evolution GO send/media takes a URL). */
function toDataUrl(base64: string, mimeType?: string): string {
  if (base64.startsWith('data:')) return base64;
  return `data:${mimeType ?? 'application/octet-stream'};base64,${pureBase64(base64)}`;
}

function toRemoteJid(recipient: string): string {
  if (recipient.includes('@')) return recipient;
  return `${recipient}@s.whatsapp.net`;
}

/** Best-effort extraction of the sent message id from Evolution GO's response. */
function extractSentId(data: unknown): string | null {
  const d = (data ?? {}) as Record<string, any>;
  const payload = (d.data ?? d) as Record<string, any>;
  return (
    payload?.id ??
    payload?.ID ??
    payload?.messageId ??
    payload?.key?.id ??
    payload?.Info?.ID ??
    payload?.message?.ID ??
    null
  );
}

export class EvolutionProvider implements WhatsAppProvider {
  readonly type = 'evolution' as const;
  private http: AxiosInstance;
  private instance: string;

  constructor(private config: EvolutionConfig) {
    this.instance = config.instance;
    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/$/, ''),
      headers: { apikey: config.apiKey, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const number = input.recipient;
    const quoted = input.replyToProviderMessageId
      ? { quoted: { messageId: input.replyToProviderMessageId } }
      : {};

    let path: string;
    let body: Record<string, unknown>;

    if (input.type === 'text') {
      path = '/send/text';
      body = { number, text: input.content ?? '', ...quoted };
    } else {
      // image | video | audio | document → /send/media (type in the body).
      path = '/send/media';
      const url = input.media?.url
        ? input.media.url
        : input.media?.base64
          ? toDataUrl(input.media.base64, input.media.mimeType)
          : '';
      body = {
        number,
        type: input.type,
        url,
        caption: input.content ?? '',
        filename: input.media?.fileName,
        ...quoted,
      };
    }

    const res = await this.http.post(path, body);
    const id = extractSentId(res.data);
    return { providerMessageIds: id ? [id] : [], raw: res.data };
  }

  async deleteMessage(providerMessageId: string, opts?: { recipient?: string }): Promise<void> {
    if (!opts?.recipient) return; // need the chat jid
    const chat = toRemoteJid(opts.recipient);
    await this.http.post('/message/delete', { chat, messageId: providerMessageId });
  }

  async downloadMedia(ref: MediaRef): Promise<DownloadResult> {
    // Evolution GO already hands us a plain (decrypted) URL for image/video/doc
    // (the inline base64 case for audio/video is consumed by the worker before
    // we get here). Download it directly.
    if (ref.url) return urlToBase64(ref.url);

    // Fallback: ask Evolution GO to decrypt the media from the original whatsmeow
    // message proto carried in the inbound payload.
    const raw = ref.raw as Record<string, any> | undefined;
    const message = raw?.message ?? raw?.data?.message ?? raw?.Message ?? raw?.data?.Message;
    if (message) {
      const res = await this.http.post('/message/downloadimage', { message });
      const out = (res.data?.data ?? res.data) as Record<string, any>;
      const base64 = out?.base64 ?? out?.Base64 ?? (typeof out === 'string' ? out : undefined);
      if (base64) return { base64: pureBase64(base64), mimeType: out?.mimetype ?? ref.mimeType };
    }
    throw new Error('evolution downloadMedia requires payload or url');
  }

  parseInbound(payload: unknown, ctx: ParseContext): NormalizedInboundMessage {
    return parseEvolutionInbound(payload, ctx);
  }

  async testConnection(): Promise<TestResult> {
    try {
      const res = await this.http.get('/instance/status', { timeout: 10000 });
      const data = (res.data?.data ?? res.data ?? {}) as Record<string, any>;
      const connected = data.Connected ?? data.connected ?? false;
      const loggedIn = data.LoggedIn ?? data.loggedIn ?? false;
      const ok = Boolean(connected && loggedIn);
      const name = data.Name ?? data.name;
      const detail = ok
        ? `conectado${name ? `: ${name}` : ''}`
        : `Connected=${connected} LoggedIn=${loggedIn}`;
      return { ok, detail };
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? '?'}: ${err.message}`
        : (err as Error).message;
      return { ok: false, detail };
    }
  }
}
