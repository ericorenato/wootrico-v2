import { hmac, logger } from '@wootrico/config';
import { cacheGet, cacheSet } from '@wootrico/cache';
import { prisma } from '@wootrico/db';
import type { AttachmentInput, ChatwootClient } from '@wootrico/chatwoot-client';
import type { WhatsAppProvider } from '@wootrico/providers';

const SYNC_TTL = 7 * 24 * 3600; // a week
const MAX_AVATAR_ATTEMPTS = 5; // bound retries when there's no pic / persistent failure
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

interface SyncedMeta {
  name?: string;
  phone?: string;
  avatarOk?: boolean; // avatar successfully UPLOADED to Chatwoot
  avatarUrl?: string; // last avatar URL applied (to detect changes)
  avatarTried?: string; // last target we fetched the avatar for
  avatarAttempts?: number; // fetch attempts so far (caps retries)
}

/**
 * Download an image to upload to Chatwoot. WhatsApp avatar URLs are fetched while
 * still fresh and the bytes are pushed to Chatwoot directly, so Chatwoot never
 * has to reach the (short-lived, often-unreachable) WhatsApp CDN itself.
 */
async function downloadImage(url: string): Promise<AttachmentInput | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? 'image/jpeg';
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_AVATAR_BYTES) return null;
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
    return { buffer: buf, filename: `avatar.${ext}`, contentType: ct };
  } catch {
    return null;
  }
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

  const update: { name?: string; phoneNumber?: string } = {};
  if (opts.name && opts.name !== prev.name) update.name = opts.name;
  if (opts.phoneE164 && opts.phoneE164 !== prev.phone) update.phoneNumber = opts.phoneE164;

  if (Object.keys(update).length) {
    await opts.chatwoot
      .updateContact(opts.contactId, update)
      .catch((err) => logger.debug({ err, integrationId: opts.integrationId }, 'updateContact failed'));
  }

  // Avatar: prefer one already in the payload (uazapi sends senderPhoto). When it
  // isn't there (Evolution), fetch it from the provider. We retry — bounded by
  // MAX_AVATAR_ATTEMPTS — until the image is actually UPLOADED to Chatwoot, since
  // a fresh URL handed to Chatwoot often fails to download server-side.
  let avatarOk = prev.avatarOk === true;
  let avatarUrl: string | undefined;
  let avatarTried = prev.avatarTried;
  let avatarAttempts = prev.avatarAttempts ?? 0;

  if (opts.avatarUrl && opts.avatarUrl !== prev.avatarUrl) {
    avatarUrl = opts.avatarUrl;
  } else if (
    !opts.avatarUrl &&
    !avatarOk &&
    avatarAttempts < MAX_AVATAR_ATTEMPTS &&
    opts.avatarTarget &&
    typeof opts.provider.fetchProfilePictureUrl === 'function'
  ) {
    avatarTried = opts.avatarTarget;
    avatarAttempts += 1;
    const url = await opts.provider.fetchProfilePictureUrl(opts.avatarTarget).catch(() => null);
    if (url) avatarUrl = url;
  }

  if (avatarUrl) {
    // Download while the URL is fresh and push the BYTES to Chatwoot (reliable).
    const img = await downloadImage(avatarUrl);
    if (img) {
      try {
        await opts.chatwoot.setContactAvatar(opts.contactId, img);
        avatarOk = true;
      } catch (err) {
        logger.debug({ err, integrationId: opts.integrationId }, 'setContactAvatar failed');
      }
    }
    // Mirror onto the GLOBAL identity row so the panel's contacts list shows it.
    await prisma.contactIdentity
      .update({ where: { id: opts.identifier }, data: { avatarUrl } })
      .catch(() => undefined);
  }

  await cacheSet(
    key,
    {
      name: opts.name ?? prev.name,
      phone: opts.phoneE164 ?? prev.phone,
      avatarOk,
      avatarUrl: avatarUrl ?? prev.avatarUrl,
      avatarTried,
      avatarAttempts,
    } satisfies SyncedMeta,
    SYNC_TTL,
  );
}
