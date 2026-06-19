import { hmac } from '@wootrico/config';
import { withLock, throttle } from '@wootrico/cache';
import { addTicket, consumeTicket } from '../engine/dedup.js';
import {
  storeMapping,
  getMappingByChatwootId,
  removeByChatwootId,
  decryptRecipient,
} from '../engine/mapping.js';
import { resolveIdentity, getIdentityById } from '../engine/identity.js';
import { loadIntegrationRuntime } from '../engine/runtime.js';
import { chatwootAttachmentType, getMessageTypeFromChatwoot } from '../lib/message-type.js';

const MEDIA_THROTTLE_MS = 1000;

/** Chatwoot webhook → provider (the outbound pipeline + dedup case 2). */
export async function handleChatwootCallback(
  rawPayload: unknown,
  integrationId: string,
): Promise<void> {
  const payload = rawPayload as any;

  const rt = await loadIntegrationRuntime(integrationId);
  if (!rt || !rt.integration) return;
  const { provider, integration, providerType, inboxId } = rt;

  const eventType = payload?.event;

  // Deletion in Chatwoot → delete on WhatsApp
  if (eventType === 'message_updated') {
    if (payload?.content_attributes?.deleted === true) {
      const cwId = String(payload.id);
      const map = await getMappingByChatwootId(integrationId, cwId);
      if (map?.providerMessageId) {
        await provider
          .deleteMessage(map.providerMessageId, { recipient: decryptRecipient(map.recipient) })
          .catch(() => undefined);
        await removeByChatwootId(integrationId, cwId);
      }
    }
    return;
  }

  if (eventType !== 'message_created') return;

  const isOutgoing =
    payload.message_type === 'outgoing' ||
    payload.message_type === 1 ||
    payload.message_type === '1';
  if (!isOutgoing || payload.private === true) return;

  const conversation = payload.conversation ?? {};
  const sender = conversation.meta?.sender ?? {};
  const isGroup =
    typeof sender.identifier === 'string' && sender.identifier.endsWith('@g.us');

  // canonicalKey: stable id for dedup/lock (same domain as inbound).
  // sendTarget: the actual phone/jid/group we send to on the provider.
  let canonicalKey: string;
  let sendTarget: string;
  if (isGroup) {
    canonicalKey = sender.identifier;
    sendTarget = sender.identifier;
  } else {
    const pn = sender.phone_number ? String(sender.phone_number).replace(/\D/g, '') : null;
    // Chatwoot's contact identifier is our canonical id (set on inbound); fall
    // back to resolving by phone so both paths agree on the same canonical key.
    const identity = pn
      ? await resolveIdentity({ pn })
      : await getIdentityById(sender.identifier);
    canonicalKey = identity?.id ?? pn ?? sender.identifier;
    // Prefer the contact's phone; else the number we discovered for it; else the
    // LID; never fall back to the canonical UUID as a send target.
    sendTarget =
      pn ?? identity?.pn ?? (identity?.lid ? `${identity.lid}@lid` : sender.identifier);
  }
  if (!canonicalKey || !sendTarget) return;

  const attachments: any[] = payload.attachments ?? [];
  const messageType = getMessageTypeFromChatwoot(attachments);

  // Serialize per conversation (ordering) — same lock domain as inbound.
  await withLock(`lock:conv:${integrationId}:${hmac(canonicalKey)}`, async () => {
    // Idempotency guard — if this Chatwoot message was already sent to the
    // provider (webhook re-delivery or queue retry), skip so we never send the
    // same message to WhatsApp twice.
    const alreadySent = await getMappingByChatwootId(integrationId, String(payload.id));
    if (alreadySent) return;

    // CASE 2 dedup — if it originated on the phone, it's already mirrored: skip.
    const consumed = await consumeTicket(integrationId, canonicalKey, messageType, 'phone_origin');
    if (consumed) return;

    // signature
    let content: string = payload.content ?? '';
    if (integration.assinarMensagem && payload.sender?.name) {
      content = `*${payload.sender.name}:*\n\n${content}`;
    }

    // reply mapping (Chatwoot reply → provider quoted message)
    let replyToProviderMessageId: string | null = null;
    let replyToParticipant: string | null = null;
    const inReplyTo = payload.content_attributes?.in_reply_to;
    if (inReplyTo) {
      const quotedMap = await getMappingByChatwootId(integrationId, String(inReplyTo));
      replyToProviderMessageId = quotedMap?.providerMessageId ?? null;
      if (replyToProviderMessageId) {
        // Evolution GO needs the quoted message author's JID to render the quote.
        // Prefer the author stored with the quoted message (works for groups);
        // fall back to the chat partner for DMs (covers older mappings).
        replyToParticipant =
          decryptRecipient(quotedMap?.senderJid ?? null) ??
          (isGroup
            ? null
            : sendTarget.includes('@')
              ? sendTarget
              : `${sendTarget}@s.whatsapp.net`);
      }
    }

    const providerMessageIds: string[] = [];
    if (attachments.length > 0) {
      for (const att of attachments) {
        await throttle(`throttle:media:${integrationId}`, MEDIA_THROTTLE_MS);
        const r = await provider.sendMessage({
          recipient: sendTarget,
          type: chatwootAttachmentType(att.file_type),
          content: content || undefined,
          media: { url: att.data_url },
          replyToProviderMessageId,
          replyToParticipant,
        });
        providerMessageIds.push(...r.providerMessageIds);
        content = ''; // caption only on the first attachment
      }
    } else {
      const r = await provider.sendMessage({
        recipient: sendTarget,
        type: 'text',
        content,
        replyToProviderMessageId,
        replyToParticipant,
      });
      providerMessageIds.push(...r.providerMessageIds);
    }

    // Our send will echo back via the provider webhook → consume on inbound (case 4).
    await addTicket(integrationId, canonicalKey, messageType, 'api_origin');

    if (providerMessageIds[0]) {
      await storeMapping({
        integrationId,
        chatwootMessageId: String(payload.id),
        providerMessageId: providerMessageIds[0],
        chatwootConversationId: String(conversation.id ?? ''),
        chatwootInboxId: inboxId,
        recipient: sendTarget,
        provider: providerType,
      });
    }
  });
}
