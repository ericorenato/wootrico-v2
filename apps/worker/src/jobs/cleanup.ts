import { prisma } from '@wootrico/db';
import { logger } from '@wootrico/config';
import { driverForStored, parseMediaConfig } from '@wootrico/storage';

/**
 * Delete media-library assets past their retention window. Done OUTSIDE the
 * main transaction because it involves storage I/O. The binary is shared
 * (deduped by sha256), so we delete the rows first, then garbage-collect any
 * binary no longer referenced by ANY row.
 */
async function sweepMedia(now: Date): Promise<{ rows: number; blobs: number }> {
  const expired = await prisma.mediaAsset.findMany({
    where: { expiresAt: { lt: now } },
    take: 2000,
    select: { id: true, storageKey: true, storageDriver: true },
  });
  if (expired.length === 0) return { rows: 0, blobs: 0 };

  const del = await prisma.mediaAsset.deleteMany({
    where: { id: { in: expired.map((e) => e.id) } },
  });

  const cfg = parseMediaConfig(await prisma.appSettings.findUnique({ where: { id: 'singleton' } }));
  const driverFor = (kind: string) => driverForStored(kind, cfg, prisma.mediaBlob);

  // Distinct keys among the deleted rows; drop the binary only if nothing else
  // still points at it (another occurrence with the same content).
  const seen = new Map<string, string>();
  for (const e of expired) if (!seen.has(e.storageKey)) seen.set(e.storageKey, e.storageDriver);

  let blobs = 0;
  for (const [key, kind] of seen) {
    const still = await prisma.mediaAsset.count({ where: { storageKey: key } });
    if (still > 0) continue;
    try {
      await driverFor(kind).delete(key);
      blobs++;
    } catch (err) {
      logger.warn({ err, key }, 'media blob delete failed');
    }
  }
  return { rows: del.count, blobs };
}

/** Delete rows past their TTL. Scheduled hourly. */
export async function runCleanup(): Promise<void> {
  const now = new Date();
  const [dedup, mappings, webhooks, sessions, messageLogs] = await prisma.$transaction([
    prisma.dedupTicket.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.messageMapping.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.webhookEvent.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.messageLog.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  const media = await sweepMedia(now).catch((err) => {
    logger.warn({ err }, 'media retention sweep failed');
    return { rows: 0, blobs: 0 };
  });
  logger.info(
    {
      dedupTickets: dedup.count,
      messageMappings: mappings.count,
      webhookEvents: webhooks.count,
      sessions: sessions.count,
      messageLogs: messageLogs.count,
      mediaAssets: media.rows,
      mediaBlobs: media.blobs,
    },
    'cleanup sweep complete',
  );
}
