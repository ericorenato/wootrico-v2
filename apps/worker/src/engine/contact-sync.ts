import { hmac, logger } from '@wootrico/config';
import { cacheGet, cacheSet } from '@wootrico/cache';
import type { ChatwootClient } from '@wootrico/chatwoot-client';
import type { WhatsAppProvider } from '@wootrico/providers';

const SYNC_TTL = 7 * 24 * 3600; // a week

interface SyncedMeta {
  name?: string;
  phone?: string;
  avatar?: boolean;
  avatarTried?: string;
}

/**
 * Keep a Chatwoot contact's data fresh. WhatsApp/Meta often omits the phone
 * number and profile info on the FIRST message (LID-only), so the contact is
 * created without them. When that data arrives later — number, display name,
 * avatar — we push it to the SAME contact (resolved via the canonical id) so the
 * conversation never splits and the contact card is completed.
 *
 * Cheap and idempotent: a Redis hash per contact avoids redundant updates, and
 * the avatar is fetched at most once per addressing target (LID, then number).
 */
export async function syncContactMeta(opts: {
  integrationId: string;
  identifier: string; // canonical key, for cache namespacing
  contactId: string | number;
  chatwoot: ChatwootClient;
  provider: WhatsAppProvider;
  name: string | null;
  phoneE164?: string;
  avatarTarget?: string | null; // phone/jid used to fetch the avatar
}): Promise<void> {
  const key = `cw:meta:${opts.integrationId}:${hmac(opts.identifier)}`;
  const prev = (await cacheGet<SyncedMeta>(key)) ?? {};

  const update: { name?: string; phoneNumber?: string; avatarUrl?: string } = {};
  if (opts.name && opts.name !== prev.name) update.name = opts.name;
  if (opts.phoneE164 && opts.phoneE164 !== prev.phone) update.phoneNumber = opts.phoneE164;

  // Fetch the avatar at most once per addressing target (so we retry once the
  // number becomes known, but never hammer the provider every message).
  let avatarDone = prev.avatar === true;
  const shouldTryAvatar =
    !avatarDone &&
    !!opts.avatarTarget &&
    opts.avatarTarget !== prev.avatarTried &&
    typeof opts.provider.fetchProfilePictureUrl === 'function';
  if (shouldTryAvatar) {
    const url = await opts.provider.fetchProfilePictureUrl!(opts.avatarTarget!).catch(() => null);
    if (url) {
      update.avatarUrl = url;
      avatarDone = true;
    }
  }

  if (Object.keys(update).length) {
    await opts.chatwoot
      .updateContact(opts.contactId, update)
      .catch((err) => logger.debug({ err, integrationId: opts.integrationId }, 'updateContact failed'));
  }

  await cacheSet(
    key,
    {
      name: opts.name ?? prev.name,
      phone: opts.phoneE164 ?? prev.phone,
      avatar: avatarDone,
      avatarTried: opts.avatarTarget ?? prev.avatarTried,
    } satisfies SyncedMeta,
    SYNC_TTL,
  );
}
