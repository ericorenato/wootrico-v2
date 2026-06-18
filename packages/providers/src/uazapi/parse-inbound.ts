import type { MessageType } from '@wootrico/config';
import type { InboundMedia, NormalizedInboundMessage } from '@wootrico/types';
import type { ParseContext } from '../provider.interface.js';
import { normalizePhone } from '../util/phone.js';

function stripJid(v: string | undefined | null): string {
  return (v ?? '').split('@')[0] ?? '';
}

function mapMediaType(m: Record<string, any>): MessageType | null {
  const raw = (m.mediaType || '').toString().toLowerCase();
  const typeName = (m.messageType || '').toString().toLowerCase();
  if (raw === 'image' || typeName === 'imagemessage') return 'image';
  if (raw === 'ptt' || raw === 'audio' || typeName === 'audiomessage') return 'audio';
  if (raw === 'video' || typeName === 'videomessage') return 'video';
  if (raw === 'document' || typeName === 'documentmessage') return 'document';
  return null;
}

/** Parse a uazapi webhook payload into the normalized shape. */
export function parseUazapiInbound(
  payload: unknown,
  ctx: ParseContext,
): NormalizedInboundMessage {
  const body = (payload ?? {}) as Record<string, any>;
  const m = (body.message ?? {}) as Record<string, any>;
  const chat = (body.chat ?? {}) as Record<string, any>;
  const content = (m.content ?? {}) as Record<string, any>;

  const base: NormalizedInboundMessage = {
    origin: 'uazapi',
    kind: 'message',
    phone: null,
    text: '',
    name: null,
    isGroup: false,
    fromMe: !!m.fromMe,
    fromApi: !!m.wasSentByApi,
    providerMessageId: m.messageid ?? m.id ?? null,
    status: m.status ?? null,
    raw: payload,
  };

  if (!body.message) {
    return { ...base, kind: 'unknown' };
  }

  // deletion (revoke)
  const messageTypeLc = (m.messageType || '').toString().toLowerCase();
  if (m.wasDeleted === true || messageTypeLc === 'revoked' || messageTypeLc === 'protocolmessage') {
    return {
      ...base,
      kind: 'message_deleted',
      deletedProviderMessageIds: [m.messageid ?? m.id].filter(Boolean) as string[],
    };
  }

  const senderRaw = stripJid(m.sender) || stripJid(m.chatid);
  const { digits } = senderRaw ? normalizePhone(senderRaw, ctx.defaultCountry) : { digits: null };

  const isGroup =
    m.isGroup === true ||
    (typeof m.chatid === 'string' && m.chatid.endsWith('@g.us')) ||
    (typeof chat.wa_chatid === 'string' && chat.wa_chatid.endsWith('@g.us'));

  const text = content.text ?? m.text ?? content.caption ?? '';

  let media: InboundMedia | null = null;
  const mediaType = mapMediaType(m);
  if (mediaType) {
    media = {
      type: mediaType,
      url: content.URL ?? content.url,
      mimeType: content.mimetype,
      fileName: content.fileName ?? content.title,
      caption: text,
    };
  }

  const result: NormalizedInboundMessage = {
    ...base,
    phone: digits,
    lid: stripJid(m.lid) || null,
    jid: senderRaw || null,
    text,
    media,
    name: chat.name ?? chat.wa_name ?? chat.wa_contactName ?? body.name ?? null,
    senderName: m.senderName ?? null,
    senderPhoto:
      chat.imagePreview ?? chat.image ?? chat.thumbnail ?? m.senderProfilePic ?? null,
    isGroup: !!isGroup,
    groupId: isGroup ? (chat.wa_chatid ?? m.chatid ?? null) : null,
    groupName: isGroup ? (m.groupName ?? chat.name ?? null) : null,
    replyToProviderMessageId: content.contextInfo?.stanzaID ?? null,
    editedProviderMessageId: m.edited ?? m.editMessageId ?? null,
  };

  if (result.editedProviderMessageId) result.kind = 'message_edited';
  if (isGroup && ctx.ignoreGroups) result.kind = 'ignored';

  return result;
}
