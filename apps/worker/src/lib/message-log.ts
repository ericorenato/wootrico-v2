import { logger, TTL, type MessageType, type ProviderType } from '@wootrico/config';
import { prisma } from '@wootrico/db';

export interface MessageLogInput {
  integrationId: string;
  provider: ProviderType;
  direction: 'incoming' | 'outgoing';
  messageType: MessageType;
  kind: 'created' | 'edited' | 'deleted';
  isReply: boolean;
  isGroup: boolean;
  providerMessageId?: string | null;
}

/**
 * Record a content-FREE semantic log of a processed message (type, whether it
 * carried media and which type, whether it was a reply, group, direction). Never
 * stores message content. Best-effort: failures are logged and swallowed so the
 * message pipeline is never affected.
 */
export async function logMessage(input: MessageLogInput): Promise<void> {
  try {
    await prisma.messageLog.create({
      data: {
        integrationId: input.integrationId,
        provider: input.provider,
        direction: input.direction,
        messageType: input.messageType,
        kind: input.kind,
        hasMedia: input.messageType !== 'text',
        isReply: input.isReply,
        isGroup: input.isGroup,
        providerMessageId: input.providerMessageId ?? null,
        expiresAt: new Date(Date.now() + TTL.webhookEventDays * 86_400_000),
      },
    });
  } catch (err) {
    logger.warn({ err, integrationId: input.integrationId }, 'message log failed (ignored)');
  }
}
