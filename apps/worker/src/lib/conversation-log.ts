import { logger, type MessageType } from '@wootrico/config';
import { prisma } from '@wootrico/db';

const PREVIEW_MAX = 200; // LGPD: store only the BEGINNING of the opening message

export interface ConversationOpenerInput {
  integrationId: string;
  chatwootConversationId: string;
  contactName?: string | null;
  contactNumber?: string | null;
  senderName?: string | null;
  isGroup: boolean;
  direction: 'incoming' | 'outgoing';
  messageType: MessageType;
  text?: string | null;
}

/** First ~200 chars of the opener; a placeholder for non-text without caption. */
function previewOf(text: string | null | undefined, type: MessageType): string {
  const t = (text ?? '').trim();
  const base = t || (type === 'text' ? '' : `[${type}]`);
  return base.length > PREVIEW_MAX ? `${base.slice(0, PREVIEW_MAX)}…` : base;
}

/**
 * Record the OPENER of a conversation — the first message of each Chatwoot
 * conversation ("window"). Idempotent per (integration, conversation) via
 * skipDuplicates, so only the first message is ever stored, and only its start.
 * Best-effort: failures never affect the message pipeline.
 */
export async function logConversationOpener(input: ConversationOpenerInput): Promise<void> {
  try {
    await prisma.conversationLog.createMany({
      data: [
        {
          integrationId: input.integrationId,
          chatwootConversationId: input.chatwootConversationId,
          contactName: input.contactName ?? null,
          contactNumber: input.contactNumber ?? null,
          senderName: input.senderName ?? null,
          isGroup: input.isGroup,
          direction: input.direction,
          messageType: input.messageType,
          preview: previewOf(input.text, input.messageType),
        },
      ],
      skipDuplicates: true,
    });
  } catch (err) {
    logger.warn({ err, integrationId: input.integrationId }, 'conversation opener log failed (ignored)');
  }
}
