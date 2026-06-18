import { hmac, logger } from '@wootrico/config';
import { cacheGet, cacheSet } from '@wootrico/cache';
import type { ChatwootClient } from '@wootrico/chatwoot-client';
import type { WhatsAppProvider } from '@wootrico/providers';

const SYNC_TTL = 7 * 24 * 3600; // a week

interface SyncedMeta {
  name?: string;
  phone?: string;
  avatar?: boolean; // an avatar has been applied at least once
  avatarUrl?: string; // last avatar URL applied (to detect changes)
  avatarTried?: string; // last target we fetched the avatar for
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
  avatarUrl?: string | null; // avatar already present in the payload (e.g. uazapi)
  avatarTarget?: string | null; // phone/jid used to fetch the avatar (e.g. evolution)
}): Promise<void> {
  const key = `cw:meta:${opts.integrationId}:${hmac(opts.identifier)}`;
  const prev = (await cacheGet<SyncedMeta>(key)) ?? {};

  const update: { name?: string; phoneNumber?: string; avatarUrl?: string } = {};
  if (opts.name && opts.name !== prev.name) update.name = opts.name;
  if (opts.phoneE164 && opts.phoneE164 !== prev.phone) update.phoneNumber = opts.phoneE164;

  // Avatar: prefer one already in the payload (uazapi sends senderPhoto). When
  // it isn't there (Evolution), fetch it from the provider — at most once per
  // addressing target so we retry when the number becomes known.
  let avatarDone = prev.avatar === true;
  let avatarUrl: string | undefined;
  let avatarTried = prev.avatarTried;
  if (opts.avatarUrl && opts.avatarUrl !== prev.avatarUrl) {
    avatarUrl = opts.avatarUrl;
  } else if (
    !opts.avatarUrl &&
    !avatarDone &&
    opts.avatarTarget &&
    opts.avatarTarget !== prev.avatarTried &&
    typeof opts.provider.fetchProfilePictureUrl === 'function'
  ) {
    avatarTried = opts.avatarTarget;
    const url = await opts.provider.fetchProfilePictureUrl(opts.avatarTarget).catch(() => null);
    if (url) avatarUrl = url;
  }
  if (avatarUrl) {
    update.avatarUrl = avatarUrl;
    avatarDone = true;
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
      avatarUrl: avatarUrl ?? prev.avatarUrl,
      avatarTried,
    } satisfies SyncedMeta,
    SYNC_TTL,
  );
}
