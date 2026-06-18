import type { MessageType } from '@wootrico/config';
import type { InboundMedia, NormalizedInboundMessage } from '@wootrico/types';
import type { ParseContext } from '../provider.interface.js';
import { normalizePhone } from '../util/phone.js';

/**
 * Parser for **Evolution GO** (whatsmeow) webhooks.
 *
 * Payload shape:
 *   { event: "Message", instanceId, instanceName, instanceToken,
 *     data: { Info: {...}, Message: {...}, IsEdit, ... } }
 *
 * - `data.Info` carries metadata (Chat, Sender, ID, IsGroup, IsFromMe, PushName, Type, MediaType).
 * - `data.Message` is the whatsmeow proto. Evolution GO additionally injects:
 *     - `mediaUrl`: a plain (already-decrypted) URL for image/video/document;
 *     - `base64`:   inline base64 for audio/ptt.
 */

function stripJid(v: string | undefined | null): string {
  return (v ?? '').split('@')[0] ?? '';
}

const MEDIA_KEYS: [string, MessageType][] = [
  ['imageMessage', 'image'],
  ['videoMessage', 'video'],
  ['audioMessage', 'audio'],
  ['documentMessage', 'document'],
  ['stickerMessage', 'image'],
];

function extractMedia(message: Record<string, any>): { media: InboundMedia | null; caption: string } {
  // document-with-caption wraps the real documentMessage one level down
  const inner = message.documentWithCaptionMessage?.message ?? message;
  for (const [key, type] of MEDIA_KEYS) {
    const m = inner[key];
    if (!m) continue;
    const caption: string = m.caption ?? '';
    const media: InboundMedia = {
      type,
      // Evolution GO gives a plain decrypted URL (image/video/doc) ...
      url: message.mediaUrl ?? inner.mediaUrl ?? undefined,
      // ... or inline base64 (audio/ptt).
      base64: message.base64 ?? inner.base64 ?? undefined,
      mimeType: m.mimetype ?? message.mimetype ?? inner.mimetype,
      fileName: m.fileName ?? m.title ?? undefined,
      caption,
    };
    return { media, caption };
  }
  return { media: null, caption: '' };
}

function getContextInfo(message: Record<string, any>): Record<string, any> | undefined {
  return (
    message.extendedTextMessage?.contextInfo ??
    message.imageMessage?.contextInfo ??
    message.videoMessage?.contextInfo ??
    message.audioMessage?.contextInfo ??
    message.documentMessage?.contextInfo ??
    message.stickerMessage?.contextInfo
  );
}

export function parseEvolutionInbound(
  payload: unknown,
  ctx: ParseContext,
): NormalizedInboundMessage {
  const body = (payload ?? {}) as Record<string, any>;
  const event = (body.event ?? '').toString();
  const data = (body.data ?? {}) as Record<string, any>;
  const info = (data.Info ?? {}) as Record<string, any>;
  const message = (data.Message ?? {}) as Record<string, any>;

  const isGroup = !!info.IsGroup;

  const base: NormalizedInboundMessage = {
    origin: 'evolution',
    kind: 'message',
    phone: null,
    text: '',
    name: info.PushName ?? null,
    isGroup,
    fromMe: !!info.IsFromMe,
    fromApi: false, // Evolution GO has no API-source flag; echo handled via mapping
    providerMessageId: info.ID ?? null,
    raw: payload,
  };

  // Only "Message" events carry chat content; ignore the rest (receipts, presence…).
  if (event && event !== 'Message') {
    return { ...base, kind: 'ignored' };
  }

  // Revoke (delete-for-everyone) arrives as a protocolMessage.
  const proto = message.protocolMessage as Record<string, any> | undefined;
  const protoType = (proto?.type ?? '').toString().toUpperCase();
  if (proto && protoType === 'REVOKE') {
    const delId = proto.key?.ID ?? proto.key?.id;
    return {
      ...base,
      kind: 'message_deleted',
      deletedProviderMessageIds: delId ? [delId] : [],
    };
  }

  const isEdit = !!data.IsEdit || protoType === 'MESSAGE_EDIT';
  // Edited content lives under protocolMessage.editedMessage
  const effective = isEdit && proto?.editedMessage ? { ...message, ...proto.editedMessage } : message;

  const { media, caption } = extractMedia(effective);
  const text =
    effective.conversation ?? effective.extendedTextMessage?.text ?? caption ?? '';

  const chatJid: string = info.Chat ?? '';
  const senderJid: string = info.Sender ?? (isGroup ? '' : chatJid);
  const phoneDigits = senderJid
    ? normalizePhone(stripJid(senderJid), ctx.defaultCountry).digits
    : null;

  const senderAlt: string = (info.SenderAlt ?? '').toString();
  const lid = senderAlt.endsWith('@lid') ? stripJid(senderAlt) : null;

  const replyTo = getContextInfo(effective)?.stanzaId ?? getContextInfo(effective)?.stanzaID ?? null;

  const result: NormalizedInboundMessage = {
    ...base,
    phone: phoneDigits,
    jid: stripJid(senderJid) || null,
    lid,
    text,
    media,
    senderName: info.PushName ?? null,
    isGroup,
    groupId: isGroup ? chatJid : null,
    groupName: null,
    replyToProviderMessageId: replyTo,
    kind: isEdit ? 'message_edited' : 'message',
    editedProviderMessageId: isEdit
      ? (proto?.key?.ID ?? proto?.key?.id ?? info.ID ?? undefined)
      : undefined,
  };

  if (isGroup && ctx.ignoreGroups) result.kind = 'ignored';
  return result;
}
