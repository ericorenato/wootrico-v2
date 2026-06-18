import { prisma } from '@wootrico/db';
import { logger } from '@wootrico/config';

/** Delete rows past their TTL. Scheduled hourly. */
export async function runCleanup(): Promise<void> {
  const now = new Date();
  const [dedup, mappings, webhooks, sessions] = await prisma.$transaction([
    prisma.dedupTicket.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.messageMapping.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.webhookEvent.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  logger.info(
    {
      dedupTickets: dedup.count,
      messageMappings: mappings.count,
      webhookEvents: webhooks.count,
      sessions: sessions.count,
    },
    'cleanup sweep complete',
  );
}
