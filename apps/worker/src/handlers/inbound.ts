import { logger, hmac } from '@wootrico/config';
import { normalizePhone } from '@wootrico/providers';
import { withLock, cacheGet, cacheSet } from '@wootrico/cache';
import type { ChatwootMessageType, ChatwootConversationStatus } from '@wootrico/chatwoot-client';
import { storeMapping, getMappingByProviderId, removeByChatwootId } from '../engine/mapping.js';
import { resolveIdentity, ingestDirectoryHints } from '../engine/identity.js';
import { syncContactMeta } from '../engine/contact-sync.js';
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

  const isGroup = norm.isGroup;
  // Pair the sender's PN↔LID onto a GLOBAL canonical id (shared across all
  // companies) for number discovery. For a DM this is the contact; for a group
  // it's just the participant who sent (the conversation is keyed by the group).
  const identity = await resolveIdentity({
    pn: norm.phone,
    lid: norm.lid,
    pushName: norm.name ?? norm.senderName,
  });
  // Seed the directory with the whole group roster (throttled, best-effort).
  if (isGroup && norm.groupId && norm.directoryHints?.length) {
    const hintKey = `idir:group:${hmac(norm.groupId)}`;
    if ((await cacheGet(hintKey)) == null) {
      await cacheSet(hintKey, 1, 6 * 3600);
      await ingestDirectoryHints(norm.directoryHints);
    }
  }
  // Canonical key — drives Chatwoot identifier, dedup and per-conversation lock.
  // Groups have no LID identity: they are keyed by the group id.
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
  const discoveredPhone = !isGroup ? (norm.phone ?? identity?.pn ?? null) : null;
  // In groups, label each message with who sent it (Chatwoot has no groups, so
  // the whole group is one contact/conversation).
  const senderLabel = norm.senderName ?? norm.name ?? null;

  const mirror = async (
    direction: ChatwootMessageType,
    opts?: { bodyOverride?: string; inReplyToOverride?: number; mappingProviderId?: string },
  ): Promise<void> => {
    const contactName = isGroup
      ? (norm.groupName ?? norm.groupId ?? identifier)
      : (norm.name ?? norm.senderName ?? (discoveredPhone ?? sendTarget));
    const phoneNumber =
      !isGroup && discoveredPhone
        ? normalizePhone(discoveredPhone, integration.defaultCountry).e164
        : undefined;
    // Prefix the participant name on group messages so it's clear who spoke.
    const body =
      opts?.bodyOverride ??
      (isGroup && senderLabel ? `*${senderLabel}:*\n${norm.text ?? ''}` : (norm.text ?? ''));

    // contact id is stable → cache it (keyed by pseudonymized identifier)
    const contactKey = `cw:contact:${integrationId}:${hmac(identifier)}`;
    let contactId = await cacheGet<string | number>(contactKey);
    if (!contactId) {
      const contact = await chatwoot.findOrCreateContact({ name: contactName, identifier, phoneNumber });
      contactId = contact?.id;
      if (contactId) await cacheSet(contactKey, contactId, CONTACT_TTL);
    }
    if (!contactId) return logger.warn({ integrationId }, 'inbound: missing contact id');

    // Complete the contact when data not present on the first (LID-only) message
    // arrives later: phone, name and avatar — keeping it the same contact. For a
    // group there's no phone and the name is the group's; the avatar is the
    // group photo (uazapi sends it in the payload; Evolution is fetched from the
    // group id, which is the avatarTarget here).
    await syncContactMeta({
      integrationId,
      identifier,
      contactId,
      chatwoot,
      provider,
      name: isGroup ? (norm.groupName ?? null) : (norm.name ?? norm.senderName ?? null),
      phoneE164: phoneNumber,
      avatarUrl: norm.senderPhoto ?? null,
      avatarTarget: sendTarget,
    });

    const conversation = await chatwoot.findOrCreateConversation({
      contactId,
      inboxId,
      status: integration.conversationStatus as ChatwootConversationStatus,
      reopen: integration.reabrirConversa,
    });
    const conversationId = conversation?.id;
    if (!conversationId) return logger.warn({ integrationId }, 'inbound: missing conversation id');

    let inReplyTo: number | undefined = opts?.inReplyToOverride;
    if (inReplyTo == null && norm.replyToProviderMessageId) {
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
        content: body,
        messageType: direction,
        attachment: {
          buffer: Buffer.from(base64, 'base64'),
          filename: norm.media.fileName ?? fileNameFor(mime, 'media'),
          contentType: mime,
        },
        inReplyTo,
        sourceId: norm.providerMessageId ?? undefined,
      });
    } else {
      created = await chatwoot.createMessage({
        conversationId,
        content: body,
        messageType: direction,
        inReplyTo,
        sourceId: norm.providerMessageId ?? undefined,
      });
    }

    // For an edit we store under a synthetic provider id (passed by the caller),
    // because a WhatsApp edit reuses the ORIGINAL message id and that id is already
    // mapped (unique constraint) — the synthetic key keeps the new Chatwoot message
    // mapped (so its echo is deduped by the callback) without colliding.
    const mappingProviderId = opts?.mappingProviderId ?? norm.providerMessageId;
    if (created?.id && mappingProviderId) {
      // Author JID of THIS message — needed later to render a reply quote (esp. in
      // groups, where the quoted author is a specific member). Only known for
      // inbound (incoming) messages; for our own echo (outgoing) the author is the
      // account owner, which we don't resolve here.
      const senderJid =
        direction === 'incoming'
          ? norm.jid
            ? `${norm.jid}@s.whatsapp.net`
            : norm.lid
              ? `${norm.lid}@lid`
              : !isGroup
                ? sendTarget.includes('@')
                  ? sendTarget
                  : `${sendTarget}@s.whatsapp.net`
                : null
          : null;
      await storeMapping({
        integrationId,
        chatwootMessageId: String(created.id),
        providerMessageId: mappingProviderId,
        chatwootConversationId: String(conversationId),
        chatwootInboxId: inboxId,
        recipient: sendTarget,
        senderJid,
        provider: providerType,
      });
    }
  };

  // Serialize per conversation so messages stay ordered (replaces the old delay).
  const lockKey = `lock:conv:${integrationId}:${hmac(identifier)}`;
  await withLock(lockKey, async () => {
    // Edited message — handle BEFORE the idempotency guard: a WhatsApp edit reuses
    // the ORIGINAL message id, so the guard below would see it as already-mirrored
    // and drop the edit. Chatwoot's API cannot change an existing message's content
    // (the `update` action only sets status), so post a NEW message carrying the
    // edited text, threaded under the original via in_reply_to.
    if (norm.kind === 'message_edited') {
      const edited = (norm.text ?? '').trim();
      // Dedup the edit on a synthetic key (original id + edited text) so a queue
      // retry / re-delivery of the same edit doesn't post it twice, while distinct
      // edits of the same message still go through.
      const editKey = `edit:${norm.providerMessageId ?? ''}:${hmac(edited)}`;
      if (await getMappingByProviderId(integrationId, editKey)) return;
      let origCwId: number | undefined;
      if (norm.editedProviderMessageId) {
        const orig = await getMappingByProviderId(integrationId, norm.editedProviderMessageId);
        if (orig) origCwId = Number(orig.chatwootMessageId);
      }
      // When the provider can't give us the new text (encrypted edit), post a notice
      // citing the original so the agent knows to re-check it on WhatsApp.
      const body = norm.editedContentUnavailable
        ? '✏️ _O contato editou esta mensagem — o novo texto não está disponível aqui. Confira no WhatsApp._'
        : edited
          ? `${edited}\n\n_(mensagem editada)_`
          : '_(mensagem editada)_';
      await mirror(norm.fromMe ? 'outgoing' : 'incoming', {
        bodyOverride: body,
        inReplyToOverride: origCwId,
        mappingProviderId: editKey,
      });
      return;
    }
    // Idempotency guard — if this provider message was already mirrored (queue
    // retry after a transient failure, or a provider re-delivery), skip it so we
    // never create a duplicate in Chatwoot. Covers both directions.
    if (norm.providerMessageId) {
      const already = await getMappingByProviderId(integrationId, norm.providerMessageId);
      if (already) return;
    }
    // CASE 1 — customer message in
    if (!norm.fromMe) {
      await mirror('incoming');
      return;
    }
    // fromMe — either our own API-send echoing back (already short-circuited by the
    // idempotency guard above, which matches it by providerMessageId), or the owner
    // typing on the phone, which we mirror into Chatwoot as an outgoing message.
    await mirror('outgoing');
  });
}
