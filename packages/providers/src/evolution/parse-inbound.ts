import type { MessageType } from '@wootrico/config';
import type { InboundMedia, NormalizedInboundMessage } from '@wootrico/types';
import type { ParseContext } from '../provider.interface.js';
import { normalizePhone } from '../util/phone.js';

function stripJid(v: string | undefined | null): string {
  return (v ?? '').split('@')[0] ?? '';
}

function extractMedia(message: Record<string, any>): { media: InboundMedia | null; text: string } {
  const map: [string, MessageType][] = [
    ['imageMessage', 'image'],
    ['videoMessage', 'video'],
    ['audioMessage', 'audio'],
    ['documentMessage', 'document'],
  ];
  for (const [key, type] of map) {
    const m = message[key];
    if (m) {
      return {
        media: {
          type,
          url: m.url,
          mimeType: m.mimetype,
          fileName: m.fileName,
          caption: m.caption,
        },
        text: m.caption ?? '',
      };
    }
  }
  return { media: null, text: '' };
}

export function parseEvolutionInbound(
  payload: unknown,
  ctx: ParseContext,
): NormalizedInboundMessage {
  const body = (payload ?? {}) as Record<string, any>;
  const event = (body.event ?? '').toString().toLowerCase().replace(/_/g, '.');
  const data = (body.data ?? {}) as Record<string, any>;

  const base: NormalizedInboundMessage = {
    origin: 'evolution',
    kind: 'message',
    phone: null,
    text: '',
    name: null,
    isGroup: false,
    fromMe: !!data?.key?.fromMe,
    fromApi: false, // evolution has no API-source flag; echo handled via mapping
    providerMessageId: data?.key?.id ?? null,
    raw: payload,
  };

  // deletion
  if (event === 'messages.delete') {
    const keys: any[] = data.keys ?? (data.key ? [data.key] : []);
    return {
      ...base,
      kind: 'message_deleted',
      deletedProviderMessageIds: keys.map((k) => k.id).filter(Boolean),
    };
  }

  if (event !== 'messages.upsert') {
    return { ...base, kind: event === 'messages.update' ? 'ignored' : 'unknown' };
  }

  const key = (data.key ?? {}) as Record<string, any>;
  const message = (data.message ?? {}) as Record<string, any>;
  const remoteJid: string = key.remoteJid ?? '';
  const isGroup = remoteJid.endsWith('@g.us');

  const { media, text: mediaCaption } = extractMedia(message);
  const text =
    message.conversation ?? message.extendedTextMessage?.text ?? mediaCaption ?? '';

  const senderJidRaw = isGroup ? key.participant : remoteJid;
  const phoneDigits =
    !isGroup && senderJidRaw
      ? normalizePhone(stripJid(senderJidRaw), ctx.defaultCountry).digits
      : null;

  const result: NormalizedInboundMessage = {
    ...base,
    phone: phoneDigits,
    jid: stripJid(senderJidRaw) || null,
    text,
    media,
    name: data.pushName ?? null,
    senderName: data.pushName ?? null,
    isGroup,
    groupId: isGroup ? remoteJid : null,
    groupName: isGroup ? (data.pushName ?? null) : null,
    replyToProviderMessageId:
      message.extendedTextMessage?.contextInfo?.stanzaId ?? null,
  };

  if (isGroup && ctx.ignoreGroups) result.kind = 'ignored';
  return result;
}
