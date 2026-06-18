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
  if (raw === 'sticker' || typeName === 'stickermessage') return 'image';
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

  const isGroup =
    m.isGroup === true ||
    (typeof m.chatid === 'string' && m.chatid.endsWith('@g.us')) ||
    (typeof chat.wa_chatid === 'string' && chat.wa_chatid.endsWith('@g.us'));

  // uazapi exposes the sender's phone (sender_pn) and LID (sender_lid) directly.
  // The contact is always the OTHER party: for an outgoing (fromMe) DM the
  // sender is US, so the contact comes from the chat id instead.
  const fromMe = !!m.fromMe;
  const pnRaw =
    !isGroup && fromMe
      ? stripJid(m.chatid) || stripJid(m.sender_pn)
      : stripJid(m.sender_pn) || stripJid(m.sender) || stripJid(m.chatid);
  const { digits } = pnRaw ? normalizePhone(pnRaw, ctx.defaultCountry) : { digits: null };
  const lidRaw = stripJid(m.sender_lid) || stripJid(m.lid);

  // Reaction: the emoji is in m.reaction. Chatwoot has no reaction type, so we
  // mirror it as a short text threaded under the reacted message. Empty = removed.
  const reactionEmoji = (m.reaction ?? '').toString().trim();
  const isReaction =
    messageTypeLc === 'reactionmessage' || (!!m.reaction && !content.text && !m.text);
  if (isReaction && !reactionEmoji) {
    return { ...base, kind: 'ignored' };
  }

  const text = isReaction
    ? `reagiu com ${reactionEmoji}`
    : (content.text ?? m.text ?? content.caption ?? '');

  let media: InboundMedia | null = null;
  const mediaType = isReaction ? null : mapMediaType(m);
  if (mediaType) {
    media = {
      type: mediaType,
      url: content.URL ?? content.url,
      mimeType: content.mimetype,
      fileName: content.fileName ?? content.title,
      caption: content.caption ?? '',
    };
  }

  const result: NormalizedInboundMessage = {
    ...base,
    phone: digits,
    lid: lidRaw || null,
    jid: pnRaw || null,
    text,
    media,
    name: chat.name ?? chat.wa_name ?? chat.wa_contactName ?? body.name ?? null,
    senderName: m.senderName ?? null,
    senderPhoto:
      chat.imagePreview ?? chat.image ?? chat.thumbnail ?? m.senderProfilePic ?? null,
    isGroup: !!isGroup,
    groupId: isGroup ? (chat.wa_chatid ?? m.chatid ?? null) : null,
    groupName: isGroup ? (m.groupName ?? chat.name ?? null) : null,
    replyToProviderMessageId:
      m.quoted ?? content.contextInfo?.stanzaID ?? content.contextInfo?.stanzaId ?? null,
    editedProviderMessageId: m.edited ?? m.editMessageId ?? null,
  };

  if (result.editedProviderMessageId) result.kind = 'message_edited';
  if (isGroup && ctx.ignoreGroups) result.kind = 'ignored';

  return result;
}
