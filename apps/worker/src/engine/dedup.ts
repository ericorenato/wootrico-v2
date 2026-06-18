import { prisma, type DedupDirection, type MessageType } from '@wootrico/db';
import { TTL, hmac } from '@wootrico/config';

const ttlMs = TTL.dedupTicketMinutes * 60 * 1000;

/** Create a dedup ticket (one row). Recipient is stored pseudonymized (HMAC). */
export async function addTicket(
  integrationId: string,
  recipient: string,
  messageType: MessageType,
  direction: DedupDirection,
): Promise<void> {
  await prisma.dedupTicket.create({
    data: {
      integrationId,
      recipient: hmac(recipient),
      messageType,
      direction,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
}

/**
 * Consume the oldest unconsumed, unexpired ticket for this key.
 * Returns true if a ticket existed and was consumed (→ caller should SKIP).
 * Uses FOR UPDATE SKIP LOCKED for race-free concurrent consumption.
 */
export async function consumeTicket(
  integrationId: string,
  recipient: string,
  messageType: MessageType,
  direction: DedupDirection,
): Promise<boolean> {
  const recipientHash = hmac(recipient);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM dedup_tickets
      WHERE integration_id = ${integrationId}
        AND recipient = ${recipientHash}
        AND message_type = ${messageType}::"MessageType"
        AND direction = ${direction}::"DedupDirection"
        AND consumed_at IS NULL
        AND expires_at > now()
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED`;
    const first = rows[0];
    if (!first) return false;
    await tx.$executeRaw`UPDATE dedup_tickets SET consumed_at = now() WHERE id = ${first.id}`;
    return true;
  });
}
