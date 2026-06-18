import type { FastifyInstance } from 'fastify';
import { encrypt, decrypt } from '@wootrico/config';
import { randomToken } from '@wootrico/config';
import {
  CreateIntegrationSchema,
  UpdateIntegrationSchema,
  TestChatwootSchema,
  ProviderConfigSchema,
  providerIdentifier,
  type ProviderConfig,
} from '@wootrico/types';
import { createProvider } from '@wootrico/providers';
import { ChatwootClient } from '@wootrico/chatwoot-client';
import { serializeIntegration } from '../lib/integration-serializer.js';
import { buildWebhookUrls, getPublicBaseUrl } from '../lib/webhook-urls.js';

export default async function integrationRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] };

  // ── list ──
  app.get('/api/integrations', guard, async () => {
    const base = await getPublicBaseUrl(app.prisma);
    const rows = await app.prisma.integration.findMany({ orderBy: { createdAt: 'desc' } });
    return { integrations: rows.map((r) => serializeIntegration(r, base)) };
  });

  // ── get one ──
  app.get('/api/integrations/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await app.prisma.integration.findUnique({ where: { id } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const base = await getPublicBaseUrl(app.prisma);
    return { integration: serializeIntegration(row, base) };
  });

  // ── create ──
  app.post('/api/integrations', guard, async (req, reply) => {
    const parsed = CreateIntegrationSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    const d = parsed.data;
    if (d.providerConfig.provider !== d.providerType)
      return reply.code(400).send({ error: 'provider_mismatch' });

    const webhookToken = randomToken();
    const created = await app.prisma.integration.create({
      data: {
        name: d.name,
        isEnabled: d.isEnabled,
        webhookToken,
        chatwootBaseUrl: d.chatwootBaseUrl,
        chatwootApiToken: encrypt(d.chatwootApiToken),
        chatwootAccountId: d.chatwootAccountId,
        chatwootInboxName: d.chatwootInboxName,
        conversationStatus: d.conversationStatus,
        reabrirConversa: d.reabrirConversa,
        desconsiderarGrupo: d.desconsiderarGrupo,
        assinarMensagem: d.assinarMensagem,
        defaultCountry: d.defaultCountry,
        providerType: d.providerType,
        providerConfig: {
          create: {
            providerType: d.providerType,
            config: encrypt(JSON.stringify(d.providerConfig)),
            providerIdentifier: providerIdentifier(d.providerConfig),
          },
        },
      },
    });

    // Best-effort: ensure the Chatwoot API inbox exists and wire its webhook.
    const base = await getPublicBaseUrl(app.prisma);
    const urls = buildWebhookUrls(base, webhookToken);
    let status: 'ok' | 'error' = 'ok';
    let inboxId: string | null = null;
    try {
      const cw = new ChatwootClient({
        baseUrl: d.chatwootBaseUrl,
        apiToken: d.chatwootApiToken,
        accountId: d.chatwootAccountId,
      });
      inboxId = await cw.ensureInbox({
        name: d.chatwootInboxName,
        webhookUrl: urls.chatwoot,
        allowMessagesAfterResolved: true,
      });
    } catch (err) {
      status = 'error';
      app.log.warn({ err }, 'ensureInbox failed during integration create');
    }

    const updated = await app.prisma.integration.update({
      where: { id: created.id },
      data: { chatwootInboxId: inboxId, status },
    });

    await app.prisma.auditLog.create({
      data: {
        adminUserId: req.user.sub,
        action: 'integration.created',
        entityType: 'integration',
        entityId: created.id,
      },
    });

    return reply.code(201).send({ integration: serializeIntegration(updated, base) });
  });

  // ── update ──
  app.patch('/api/integrations/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await app.prisma.integration.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const parsed = UpdateIntegrationSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    const d = parsed.data;

    const data: Record<string, unknown> = {};
    for (const k of [
      'name',
      'isEnabled',
      'chatwootBaseUrl',
      'chatwootAccountId',
      'chatwootInboxName',
      'conversationStatus',
      'reabrirConversa',
      'desconsiderarGrupo',
      'assinarMensagem',
      'defaultCountry',
    ] as const) {
      if (d[k] !== undefined) data[k] = d[k];
    }
    if (d.chatwootApiToken) data.chatwootApiToken = encrypt(d.chatwootApiToken);

    if (d.providerConfig) {
      if (d.providerType && d.providerConfig.provider !== d.providerType)
        return reply.code(400).send({ error: 'provider_mismatch' });
      data.providerType = d.providerConfig.provider;
      await app.prisma.providerConfig.update({
        where: { integrationId: id },
        data: {
          providerType: d.providerConfig.provider,
          config: encrypt(JSON.stringify(d.providerConfig)),
          providerIdentifier: providerIdentifier(d.providerConfig),
        },
      });
    }

    const updated = await app.prisma.integration.update({ where: { id }, data });
    await app.prisma.auditLog.create({
      data: {
        adminUserId: req.user.sub,
        action: 'integration.updated',
        entityType: 'integration',
        entityId: id,
      },
    });
    const base = await getPublicBaseUrl(app.prisma);
    return { integration: serializeIntegration(updated, base) };
  });

  // ── delete ──
  app.delete('/api/integrations/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await app.prisma.integration.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await app.prisma.integration.delete({ where: { id } });
    await app.prisma.auditLog.create({
      data: {
        adminUserId: req.user.sub,
        action: 'integration.deleted',
        entityType: 'integration',
        entityId: id,
      },
    });
    return reply.code(204).send();
  });

  // ── test connection: Chatwoot ──
  app.post('/api/integrations/test/chatwoot', guard, async (req, reply) => {
    const parsed = TestChatwootSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    const cw = new ChatwootClient({
      baseUrl: parsed.data.chatwootBaseUrl,
      apiToken: parsed.data.chatwootApiToken,
      accountId: parsed.data.chatwootAccountId,
    });
    return cw.testConnection();
  });

  // ── test connection: provider ──
  app.post('/api/integrations/test/provider', guard, async (req, reply) => {
    const parsed = ProviderConfigSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    try {
      const provider = createProvider(parsed.data as ProviderConfig);
      return await provider.testConnection();
    } catch (err) {
      return reply.code(400).send({ ok: false, detail: (err as Error).message });
    }
  });
}

/** Decrypt a stored provider config (used by the worker too). */
export function decryptProviderConfig(encrypted: string): ProviderConfig {
  return JSON.parse(decrypt(encrypted)) as ProviderConfig;
}
