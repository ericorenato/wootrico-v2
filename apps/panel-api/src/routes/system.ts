import type { FastifyInstance } from 'fastify';
import { env } from '@wootrico/config';
import { evaluateLicense, getLicenseState } from '@wootrico/license-client';
import { getPublicBaseUrl } from '../lib/webhook-urls.js';

/** System configuration overview — what's set up and what's in use. */
export default async function systemRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] };

  app.get('/api/system/info', guard, async () => {
    const publicBaseUrl = await getPublicBaseUrl(app.prisma);
    const settings = await app.prisma.appSettings.findUnique({ where: { id: 'singleton' } });

    const [integrations, identityCount, adminCount] = await Promise.all([
      app.prisma.integration.findMany({
        select: {
          id: true,
          name: true,
          isEnabled: true,
          providerType: true,
          status: true,
          chatwootAccountId: true,
          chatwootInboxName: true,
          chatwootInboxId: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      app.prisma.contactIdentity.count(),
      app.prisma.adminUser.count(),
    ]);

    const byProvider = { evolution: 0, uazapi: 0, zapi: 0 } as Record<string, number>;
    const byStatus = { ok: 0, error: 0, unconfigured: 0 } as Record<string, number>;
    for (const i of integrations) {
      byProvider[i.providerType] = (byProvider[i.providerType] ?? 0) + 1;
      byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    }

    let license: Record<string, unknown> = { status: 'unknown' };
    try {
      const status = await evaluateLicense();
      const state = await getLicenseState();
      license = {
        status,
        required: env.LICENSE_REQUIRED,
        instanceId: state.instanceId,
        serverUrl: process.env.LICENSE_SERVER_URL,
        tokenExpiresAt: state.tokenExpiresAt,
        lastHeartbeatAt: state.lastHeartbeatAt,
      };
    } catch {
      license = { status: 'unknown', required: env.LICENSE_REQUIRED };
    }

    return {
      app: {
        publicBaseUrl,
        webhookBase: `${publicBaseUrl}/webhook`,
        setupCompleted: settings?.setupCompleted ?? false,
        admins: adminCount,
        nodeEnv: process.env.NODE_ENV ?? 'production',
      },
      license,
      directory: { contactIdentities: identityCount },
      integrations: {
        total: integrations.length,
        enabled: integrations.filter((i) => i.isEnabled).length,
        byProvider,
        byStatus,
        items: integrations,
      },
    };
  });
}
