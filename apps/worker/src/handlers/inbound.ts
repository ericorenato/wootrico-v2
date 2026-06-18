import { logger, hmac } from '@wootrico/config';
import { normalizePhone } from '@wootrico/providers';
import { withLock, cacheGet, cacheSet } from '@wootrico/cache';
import type { ChatwootMessageType, ChatwootConversationStatus } from '@wootrico/chatwoot-client';
import { addTicket, consumeTicket } from '../engine/dedup.js';
import { storeMapping, getMappingByProviderId, removeByChatwootId } from '../engine/mapping.js';
import { resolveIdentity } from '../engine/identity.js';
import { loadIntegrationRuntime } from '../engine/runtime.js';
import { fileNameFor } from '../lib/message-type.js';

const CONTACT_TTL = 3600; // seconds

/** Provider webhook → Chatwoot (inbound pipeline + dedup cases 1/3/4). */
export async function handleInbound(payload: unknown, integrationId: string): Promise<void> {
  const rt = await loadIntegrationRuntime(integrationId);
  if (!rt || !rt.integration) return;
  const { provider, chatwoot, inboxId, providerType, integration } = rt;

  const norm = provider.parseInbound(payload, {
    defaultCountry: integration.defaultCountry,
    ignoreGroups: integration.desconsiderarGrupo,
  });

  if (norm.kind === 'ignored' || norm.kind === 'unknown') return;

  if (norm.kind === 'message_deleted') {
    for (const pid of norm.deletedProviderMessageIds ?? []) {
      const map = await getMappingByProviderId(integrationId, pid);
      if (map?.chatwootConversationId) {
        await chatwoot
          .deleteMessage(map.chatwootConversationId, map.chatwootMessageId)
          .catch(() => undefined);
        await removeByChatwootId(integrationId, map.chatwootMessageId);
      }
    }
    return;
  }

  if (norm.kind === 'message_edited') return;

  const isGroup = norm.isGroup;
  // Pair PN↔LID onto a GLOBAL canonical id (shared across all companies) so the
  // same person always maps to the same Chatwoot contact and so a number known
  // by one company is discoverable when another only sees the LID.
  const identity = isGroup
    ? null
    : await resolveIdentity({
        pn: norm.phone,
        lid: norm.lid,
        pushName: norm.name ?? norm.senderName,
      });
  // Canonical key — drives Chatwoot identifier, dedup and per-conversation lock.
  const identifier = isGroup
    ? (norm.groupId ?? '')
    : (identity?.id ?? norm.phone ?? norm.jid ?? norm.lid ?? '');
  if (!identifier) return;
  // Actual address used to send/delete on the provider (phone, jid or group id).
  // We reply via what THIS company received, not the globally-discovered number.
  const sendTarget = isGroup
    ? (norm.groupId ?? identifier)
    : (norm.phone ?? norm.jid ?? (identity?.lid ? `${identity.lid}@lid` : identifier));
  // Phone shown in Chatwoot: prefer what arrived, else the number discovered in
  // the global directory (e.g. another company already paired this LID↔number).
  const discoveredPhone = norm.phone ?? identity?.pn ?? null;
  const messageType = norm.media?.type ?? 'text';

  const mirror = async (direction: ChatwootMessageType): Promise<void> => {
    const contactName = norm.name ?? norm.senderName ?? (discoveredPhone ?? sendTarget);
    const phoneNumber =
      !isGroup && discoveredPhone
        ? normalizePhone(discoveredPhone, integration.defaultCountry).e164
        : undefined;

    // contact id is stable → cache it (keyed by pseudonymized identifier)
    const contactKey = `cw:contact:${integrationId}:${hmac(identifier)}`;
    let contactId = await cacheGet<string | number>(contactKey);
    if (!contactId) {
      const contact = await chatwoot.findOrCreateContact({ name: contactName, identifier, phoneNumber });
      contactId = contact?.id;
      if (contactId) await cacheSet(contactKey, contactId, CONTACT_TTL);
    }
    if (!contactId) return logger.warn({ integrationId }, 'inbound: missing contact id');

    const conversation = await chatwoot.findOrCreateConversation({
      contactId,
      inboxId,
      status: integration.conversationStatus as ChatwootConversationStatus,
      reopen: integration.reabrirConversa,
    });
    const conversationId = conversation?.id;
    if (!conversationId) return logger.warn({ integrationId }, 'inbound: missing conversation id');

    let inReplyTo: number | undefined;
    if (norm.replyToProviderMessageId) {
      const m = await getMappingByProviderId(integrationId, norm.replyToProviderMessageId);
      if (m) inReplyTo = Number(m.chatwootMessageId);
    }

    let created: any;
    if (norm.media) {
      let base64 = norm.media.base64;
      let mime = norm.media.mimeType;
      if (!base64) {
        const dl = await provider.downloadMedia({
          providerMessageId: norm.providerMessageId ?? undefined,
          url: norm.media.url,
          mimeType: norm.media.mimeType,
          raw: norm.raw,
        });
        base64 = dl.base64;
        mime = dl.mimeType ?? mime;
      }
      mime = mime ?? 'application/octet-stream';
      created = await chatwoot.createMessageWithAttachment({
        conversationId,
        content: norm.text ?? '',
        messageType: direction,
        attachment: {
          buffer: Buffer.from(base64, 'base64'),
          filename: norm.media.fileName ?? fileNameFor(mime, 'media'),
          contentType: mime,
        },
        inReplyTo,
      });
    } else {
      created = await chatwoot.createMessage({
        conversationId,
        content: norm.text ?? '',
        messageType: direction,
        inReplyTo,
      });
    }

    if (created?.id && norm.providerMessageId) {
      await storeMapping({
        integrationId,
        chatwootMessageId: String(created.id),
        providerMessageId: norm.providerMessageId,
        chatwootConversationId: String(conversationId),
        chatwootInboxId: inboxId,
        recipient: sendTarget,
        provider: providerType,
      });
    }
  };

  // Serialize per conversation so messages stay ordered (replaces the old delay).
  const lockKey = `lock:conv:${integrationId}:${hmac(identifier)}`;
  await withLock(lockKey, async () => {
    // CASE 1 — customer message in
    if (!norm.fromMe) {
      await mirror('incoming');
      return;
    }
    // fromMe — our own API send echoing back, or agent typed on the phone.
    if (norm.providerMessageId) {
      const existing = await getMappingByProviderId(integrationId, norm.providerMessageId);
      if (existing) return; // our own send, already mirrored
    }
    const consumed = await consumeTicket(integrationId, identifier, messageType, 'api_origin');
    if (consumed) return;
    await addTicket(integrationId, identifier, messageType, 'phone_origin');
    await mirror('outgoing');
  });
}
