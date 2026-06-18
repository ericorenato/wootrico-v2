import { prisma } from '@wootrico/db';

/**
 * Contact identity resolution.
 *
 * WhatsApp is migrating from phone numbers (PN, `@s.whatsapp.net`) to a
 * privacy-preserving LID (`@lid`). The same person can arrive as a PN, a LID,
 * or both, and which one shows up may change over time. We pair them onto a
 * single internal UUID so dedup/lock/conversation history stay consistent — in
 * effect, our own copy of whatsmeow's PN↔LID map, fed by what the provider
 * gives us in each event.
 */

export interface ResolvedIdentity {
  /** Canonical key — use this for Chatwoot identifier, dedup, lock. */
  id: string;
  pn: string | null;
  lid: string | null;
  chatwootContactId: string | null;
  chatwootConversationId: string | null;
}

export interface IdentityInput {
  pn?: string | null; // phone digits, no @s.whatsapp.net
  lid?: string | null; // LID number, no @lid
  pushName?: string | null;
}

function clean(v?: string | null): string | null {
  const s = (v ?? '').trim();
  return s ? s : null;
}

function toResolved(row: {
  id: string;
  pn: string | null;
  lid: string | null;
  chatwootContactId: string | null;
  chatwootConversationId: string | null;
}): ResolvedIdentity {
  return {
    id: row.id,
    pn: row.pn,
    lid: row.lid,
    chatwootContactId: row.chatwootContactId,
    chatwootConversationId: row.chatwootConversationId,
  };
}

/**
 * Resolve a sender (phone and/or LID) to its canonical ContactIdentity, pairing
 * the two as they are observed and merging rows that turn out to be the same
 * person. Returns null when neither identifier is present (e.g. group chats).
 */
export async function resolveIdentity(
  integrationId: string,
  input: IdentityInput,
): Promise<ResolvedIdentity | null> {
  const pn = clean(input.pn);
  const lid = clean(input.lid);
  const pushName = clean(input.pushName);
  if (!pn && !lid) return null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const byLid = lid
          ? await tx.contactIdentity.findUnique({
              where: { integrationId_lid: { integrationId, lid } },
            })
          : null;
        const byPn = pn
          ? await tx.contactIdentity.findUnique({
              where: { integrationId_pn: { integrationId, pn } },
            })
          : null;

        // Same person seen under two separate rows → merge (LID is the stable id).
        if (byLid && byPn && byLid.id !== byPn.id) {
          await tx.contactIdentity.delete({ where: { id: byPn.id } });
          const merged = await tx.contactIdentity.update({
            where: { id: byLid.id },
            data: {
              pn: byLid.pn ?? byPn.pn ?? pn,
              lid: byLid.lid ?? lid,
              pushName: pushName ?? byLid.pushName ?? byPn.pushName,
              chatwootContactId: byLid.chatwootContactId ?? byPn.chatwootContactId,
              chatwootConversationId:
                byLid.chatwootConversationId ?? byPn.chatwootConversationId,
              lastSeenAt: new Date(),
            },
          });
          return toResolved(merged);
        }

        const existing = byLid ?? byPn;
        if (existing) {
          const data: Record<string, unknown> = { lastSeenAt: new Date() };
          if (pn && !existing.pn) data.pn = pn;
          if (lid && !existing.lid) data.lid = lid;
          if (pushName && pushName !== existing.pushName) data.pushName = pushName;
          const row =
            Object.keys(data).length > 1
              ? await tx.contactIdentity.update({ where: { id: existing.id }, data })
              : existing;
          return toResolved(row);
        }

        const created = await tx.contactIdentity.create({
          data: { integrationId, pn, lid, pushName, lastSeenAt: new Date() },
        });
        return toResolved(created);
      });
    } catch (err: unknown) {
      // Unique race (two events for the same brand-new contact): retry once.
      if ((err as { code?: string })?.code === 'P2002' && attempt === 0) continue;
      throw err;
    }
  }
  return null;
}

/** Look up an identity by its canonical id (used on the outbound path). */
export async function getIdentityById(
  integrationId: string,
  id?: string | null,
): Promise<ResolvedIdentity | null> {
  if (!id) return null;
  const row = await prisma.contactIdentity.findFirst({ where: { id, integrationId } });
  return row ? toResolved(row) : null;
}

/** Cache the resolved Chatwoot contact/conversation ids onto the identity. */
export async function cacheIdentityChatwoot(
  id: string,
  refs: { contactId?: string | number | null; conversationId?: string | number | null },
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (refs.contactId != null) data.chatwootContactId = String(refs.contactId);
  if (refs.conversationId != null) data.chatwootConversationId = String(refs.conversationId);
  if (!Object.keys(data).length) return;
  await prisma.contactIdentity.update({ where: { id }, data }).catch(() => undefined);
}
