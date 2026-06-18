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

/** Strip a data: URL prefix — evolution expects pure base64. */
function pureBase64(value: string): string {
  const idx = value.indexOf('base64,');
  return idx >= 0 ? value.slice(idx + 'base64,'.length) : value;
}

function toRemoteJid(recipient: string): string {
  if (recipient.includes('@')) return recipient;
  return `${recipient}@s.whatsapp.net`;
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
      ? { quoted: { key: { id: input.replyToProviderMessageId } } }
      : {};

    let path: string;
    let body: Record<string, unknown>;

    if (input.type === 'text') {
      path = `/message/sendText/${this.instance}`;
      body = { number, text: input.content ?? '', ...quoted };
    } else if (input.type === 'audio') {
      path = `/message/sendWhatsAppAudio/${this.instance}`;
      const audio = input.media?.url ?? (input.media?.base64 ? pureBase64(input.media.base64) : '');
      body = { number, audio, ...quoted };
    } else {
      path = `/message/sendMedia/${this.instance}`;
      const media = input.media?.url ?? (input.media?.base64 ? pureBase64(input.media.base64) : '');
      body = {
        number,
        mediatype: input.type, // image | video | document
        media,
        mimetype: input.media?.mimeType,
        caption: input.content ?? '',
        fileName: input.media?.fileName,
        ...quoted,
      };
    }

    const res = await this.http.post(path, body);
    const id = res.data?.key?.id ?? res.data?.messageId ?? null;
    return { providerMessageIds: [id].filter(Boolean) as string[], raw: res.data };
  }

  async deleteMessage(providerMessageId: string, opts?: { recipient?: string }): Promise<void> {
    if (!opts?.recipient) return; // need remoteJid
    const remoteJid = toRemoteJid(opts.recipient);
    await this.http.delete(`/chat/deleteMessageForEveryone/${this.instance}`, {
      data: { id: providerMessageId, remoteJid, fromMe: true },
    });
  }

  async downloadMedia(ref: MediaRef): Promise<DownloadResult> {
    // Preferred: ask evolution to decode the media from the original message.
    const raw = ref.raw as { data?: unknown } | undefined;
    if (raw?.data) {
      try {
        const res = await this.http.post(
          `/chat/getBase64FromMediaMessage/${this.instance}`,
          { message: raw.data },
        );
        const base64 = res.data?.base64;
        if (base64) return { base64, mimeType: res.data?.mimetype ?? ref.mimeType };
      } catch {
        // fall through to URL
      }
    }
    if (ref.url) return urlToBase64(ref.url);
    throw new Error('evolution downloadMedia requires payload or url');
  }

  parseInbound(payload: unknown, ctx: ParseContext): NormalizedInboundMessage {
    return parseEvolutionInbound(payload, ctx);
  }

  async testConnection(): Promise<TestResult> {
    try {
      const res = await this.http.get(`/instance/connectionState/${this.instance}`, {
        timeout: 10000,
      });
      const state = res.data?.instance?.state ?? res.data?.state ?? 'unknown';
      return { ok: state === 'open', detail: `state: ${state}` };
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? '?'}: ${err.message}`
        : (err as Error).message;
      return { ok: false, detail };
    }
  }
}
