import type { InboundMedia, NormalizedInboundMessage } from '@wootrico/types';
import type { ParseContext } from '../provider.interface.js';
import { normalizePhone } from '../util/phone.js';

function mediaFromBody(body: Record<string, any>): InboundMedia | null {
  if (body.image)
    return {
      type: 'image',
      url: body.image.imageUrl,
      base64: body.image.base64,
      mimeType: body.image.mimeType,
      caption: body.image.caption,
    };
  if (body.audio)
    return {
      type: 'audio',
      url: body.audio.audioUrl,
      base64: body.audio.base64,
      mimeType: body.audio.mimeType,
    };
  if (body.video)
    return {
      type: 'video',
      url: body.video.videoUrl,
      base64: body.video.base64,
      mimeType: body.video.mimeType,
      caption: body.video.caption,
    };
  if (body.document)
    return {
      type: 'document',
      url: body.document.documentUrl,
      base64: body.document.base64,
      mimeType: body.document.mimeType,
      fileName: body.document.fileName,
      caption: body.document.caption,
    };
  return null;
}

export function parseZapiInbound(
  payload: unknown,
  ctx: ParseContext,
): NormalizedInboundMessage {
  const body = (payload ?? {}) as Record<string, any>;

  const base: NormalizedInboundMessage = {
    origin: 'zapi',
    kind: 'message',
    phone: null,
    text: '',
    name: null,
    isGroup: false,
    fromMe: !!body.fromMe,
    fromApi: !!body.fromApi,
    providerMessageId: body.messageId ?? null,
    raw: payload,
  };

  // revoke (delete)
  if (body.notification === 'REVOKE') {
    return {
      ...base,
      kind: 'message_deleted',
      deletedProviderMessageIds: [body.referenceMessageId ?? body.messageId].filter(
        Boolean,
      ) as string[],
    };
  }

  // reaction: z-api delivers a `reaction` object. Chatwoot has no reaction type,
  // so we mirror it as a short text threaded under the reacted message (same as
  // evolution/uazapi). Empty value = the reaction was removed → ignore.
  const reaction = (body.reaction ?? {}) as Record<string, any>;
  if (body.reaction) {
    const emoji = (reaction.value ?? '').toString().trim();
    const isGroupR = body.isGroup === true;
    if (!emoji || (isGroupR && ctx.ignoreGroups)) {
      return { ...base, kind: 'ignored' };
    }
    const pnDigits =
      !isGroupR && body.phone ? normalizePhone(body.phone, ctx.defaultCountry).digits : null;
    return {
      ...base,
      phone: pnDigits,
      jid: body.phone ?? null,
      text: `reagiu com ${emoji}`,
      name: body.senderName ?? body.chatName ?? null,
      senderName: body.senderName ?? null,
      senderPhoto: body.photo ?? body.senderPhoto ?? null,
      isGroup: isGroupR,
      groupId: isGroupR ? (body.phone ?? null) : null,
      groupName: isGroupR ? (body.chatName ?? null) : null,
      replyToProviderMessageId: reaction.referencedMessage?.messageId ?? null,
    };
  }

  const isGroup = body.isGroup === true;
  const media = mediaFromBody(body);
  const text = body.text?.message ?? media?.caption ?? '';
  const phoneDigits =
    !isGroup && body.phone ? normalizePhone(body.phone, ctx.defaultCountry).digits : null;

  const result: NormalizedInboundMessage = {
    ...base,
    phone: phoneDigits,
    jid: body.phone ?? null,
    text,
    media,
    name: body.senderName ?? body.chatName ?? null,
    senderName: body.senderName ?? null,
    senderPhoto: body.photo ?? body.senderPhoto ?? null,
    isGroup,
    groupId: isGroup ? (body.phone ?? null) : null,
    groupName: isGroup ? (body.chatName ?? null) : null,
    replyToProviderMessageId: body.referenceMessageId ?? null,
    editedProviderMessageId: body.isEdit ? (body.editMessageId ?? null) : null,
  };

  if (result.editedProviderMessageId) result.kind = 'message_edited';
  if (isGroup && ctx.ignoreGroups) result.kind = 'ignored';
  return result;
}
