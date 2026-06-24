import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@wootrico/db';
import { requireActiveLicense } from '../lib/license-guard.js';

/** Search across the contact/sender names, number and the opener preview. */
function buildWhere(search: string, from?: string, to?: string): Prisma.ConversationLogWhereInput {
  const where: Prisma.ConversationLogWhereInput = {};
  if (search) {
    where.OR = [
      { contactName: { contains: search, mode: 'insensitive' } },
      { contactNumber: { contains: search, mode: 'insensitive' } },
      { senderName: { contains: search, mode: 'insensitive' } },
      { preview: { contains: search, mode: 'insensitive' } },
    ];
  }
  const startedAt: { gte?: Date; lte?: Date } = {};
  if (from) startedAt.gte = new Date(from);
  if (to) startedAt.lte = new Date(to);
  if (from || to) where.startedAt = startedAt;
  return where;
}

const SELECT = {
  chatwootConversationId: true,
  contactName: true,
  contactNumber: true,
  senderName: true,
  isGroup: true,
  direction: true,
  messageType: true,
  preview: true,
  startedAt: true,
  integration: { select: { name: true } },
} satisfies Prisma.ConversationLogSelect;

function csvSafe(v: string | null): string {
  return (v ?? '').replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Captured conversations (openers) — grouped by Chatwoot conversation. LGPD: only
 * the BEGINNING of the opening message is stored/shown. List + JSON/TXT export.
 * All endpoints require an ACTIVE license; without it the feature is blocked
 * (settings remain editable elsewhere).
 */
export default async function conversationRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] };

  app.get('/api/conversations', guard, async (req, reply) => {
    const lic = await requireActiveLicense();
    if (!lic.allowed) return reply.code(403).send({ error: 'license_inactive', status: lic.status });

    const q = req.query as { search?: string; from?: string; to?: string; page?: string; pageSize?: string };
    const search = (q.search ?? '').trim();
    const page = Math.max(parseInt(q.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(q.pageSize ?? '50', 10) || 50, 1), 200);
    const where = buildWhere(search, q.from, q.to);

    const [total, rows] = await Promise.all([
      app.prisma.conversationLog.count({ where }),
      app.prisma.conversationLog.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: SELECT,
      }),
    ]);

    const conversations = rows.map((c) => ({
      conversationId: c.chatwootConversationId,
      name: c.contactName,
      number: c.contactNumber,
      sender: c.senderName,
      isGroup: c.isGroup,
      direction: c.direction,
      messageType: c.messageType,
      preview: c.preview,
      integration: c.integration?.name ?? null,
      startedAt: c.startedAt.toISOString(),
    }));
    return { conversations, total, page, pageSize };
  });

  // Export the (filtered) conversations as JSON or TXT — name, date, time, phrase.
  app.get('/api/conversations/export', guard, async (req, reply) => {
    const lic = await requireActiveLicense();
    if (!lic.allowed) return reply.code(403).send({ error: 'license_inactive', status: lic.status });

    const q = req.query as { format?: string; search?: string; from?: string; to?: string };
    const format = q.format === 'json' ? 'json' : 'txt';
    const where = buildWhere((q.search ?? '').trim(), q.from, q.to);

    const rows = await app.prisma.conversationLog.findMany({
      where,
      orderBy: { startedAt: 'asc' },
      take: 100_000, // safety cap
      select: SELECT,
    });

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      const data = rows.map((c) => {
        const iso = c.startedAt.toISOString();
        return {
          nome: c.contactName,
          numero: c.contactNumber,
          remetente: c.senderName,
          grupo: c.isGroup,
          data: iso.slice(0, 10),
          hora: iso.slice(11, 19),
          frase: c.preview,
          integracao: c.integration?.name ?? null,
        };
      });
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="conversas-${stamp}.json"`)
        .send(JSON.stringify(data, null, 2));
    }

    const lines = rows.map((c) => {
      const iso = c.startedAt.toISOString();
      const when = `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
      const who = csvSafe(c.contactName) || csvSafe(c.contactNumber) || 'sem nome';
      const num = c.contactNumber ? ` (${csvSafe(c.contactNumber)})` : '';
      const sender = c.isGroup && c.senderName ? ` · ${csvSafe(c.senderName)}` : '';
      return `${when} — ${who}${num}${sender} — ${csvSafe(c.preview)}`;
    });
    const txt = '﻿' + lines.join('\r\n') + '\r\n';
    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="conversas-${stamp}.txt"`)
      .send(txt);
  });
}
