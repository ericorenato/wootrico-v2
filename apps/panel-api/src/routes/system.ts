import type { FastifyInstance } from 'fastify';
import { env, encrypt, decrypt } from '@wootrico/config';
import { evaluateLicense, getLicenseState } from '@wootrico/license-client';
import { pingRabbit, testRabbitUrl } from '@wootrico/queue';
import { pingRedis, testRedisUrl } from '@wootrico/cache';
import { PrismaClient } from '@wootrico/db';
import { getConnSnapshot } from '@wootrico/db/conn';
import { getPublicBaseUrl } from '../lib/webhook-urls.js';

/** Hide the password component of a connection URL for display. */
function maskUrl(url: string): string {
  return url ? url.replace(/\/\/([^:/@]+):([^@/]+)@/, '//$1:****@') : '';
}

/** Validate a Postgres URL by opening a throwaway client and running SELECT 1. */
async function testPgUrl(url: string): Promise<{ ok: boolean; detail?: string }> {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    await client.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

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

  // Live connection diagnostics — tests Postgres/RabbitMQ/Redis from INSIDE the
  // running container (so it validates exactly what the app uses, no installer).
  app.post('/api/system/diagnostics', guard, async () => {
    const testPostgres = async () => {
      const t0 = Date.now();
      try {
        await app.prisma.$queryRaw`SELECT 1`;
        return { ok: true, detail: `ok (${Date.now() - t0}ms)` };
      } catch (err) {
        return { ok: false, detail: (err as Error).message };
      }
    };

    const [postgres, rabbitmq, redis] = await Promise.all([
      testPostgres(),
      pingRabbit(),
      pingRedis(),
    ]);

    return { postgres, rabbitmq, redis };
  });

  // ── connection settings (editable; applied on restart) ──
  // Returns the desired connection strings (decrypted, for editing — admin-only,
  // no-store) plus what's actually running and whether a restart is pending.
  app.get('/api/system/connections', guard, async () => {
    const s = await app.prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    const snap = getConnSnapshot();

    const dec = (v?: string | null) => {
      if (!v) return '';
      try {
        return decrypt(v);
      } catch {
        return '';
      }
    };

    const rabbitDesired = dec(s?.rabbitmqUrl) || env.RABBITMQ_URL;
    const redisDesired = dec(s?.redisUrl) || env.REDIS_URL;
    const pgDesired = dec(s?.databaseUrl) || process.env.DATABASE_URL || '';

    const runningRabbit = snap?.rabbitmqUrl ?? env.RABBITMQ_URL;
    const runningRedis = snap?.redisUrl ?? env.REDIS_URL;
    const runningPg = snap?.databaseUrl ?? process.env.DATABASE_URL ?? '';

    return {
      restartRequestedAt: s?.restartRequestedAt ?? null,
      services: {
        postgres: {
          value: pgDesired,
          running: maskUrl(runningPg),
          changed: pgDesired !== runningPg,
          hotApply: false, // Postgres can't be hot-applied (needed to read settings)
        },
        rabbitmq: {
          value: rabbitDesired,
          running: maskUrl(runningRabbit),
          changed: rabbitDesired !== runningRabbit,
          hotApply: true,
        },
        redis: {
          value: redisDesired,
          running: maskUrl(runningRedis),
          changed: redisDesired !== runningRedis,
          hotApply: true,
        },
      },
    };
  });

  // ── edit connection settings: TEST each provided value before persisting ──
  // Body: { rabbitmqUrl?, redisUrl?, databaseUrl? }. "" clears the override
  // (revert to env). If any test fails, nothing is saved.
  app.put('/api/system/connections', guard, async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: Array<{
      key: 'rabbitmqUrl' | 'redisUrl' | 'databaseUrl';
      service: string;
      test: (url: string) => Promise<{ ok: boolean; detail?: string }>;
    }> = [
      { key: 'rabbitmqUrl', service: 'RabbitMQ', test: testRabbitUrl },
      { key: 'redisUrl', service: 'Redis', test: testRedisUrl },
      { key: 'databaseUrl', service: 'Postgres', test: testPgUrl },
    ];

    const data: Record<string, string | null> = {};
    const results: Record<string, { ok: boolean; detail?: string }> = {};

    for (const f of fields) {
      if (!(f.key in body)) continue;
      const raw = String(body[f.key] ?? '').trim();
      if (!raw) {
        // Clear the override → fall back to env on next boot.
        data[f.key] = null;
        results[f.key] = { ok: true, detail: 'usará o valor do ambiente' };
        continue;
      }
      const r = await f.test(raw);
      results[f.key] = r;
      if (r.ok) data[f.key] = encrypt(raw);
    }

    const anyFailed = Object.values(results).some((r) => !r.ok);
    if (anyFailed) {
      // Test-before-apply: if any value failed its connection test, persist
      // nothing and report per-field results so the user can fix them.
      return { ok: false, results };
    }

    if (Object.keys(data).length > 0) {
      await app.prisma.appSettings.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', ...data },
        update: data,
      });
      await app.prisma.auditLog
        .create({
          data: {
            adminUserId: req.user.sub,
            action: 'system.connections.updated',
            entityType: 'app_settings',
            entityId: 'singleton',
          },
        })
        .catch(() => undefined);
    }

    return { ok: true, results };
  });

  // ── restart: signal worker + self-exit so Swarm recreates with new settings ──
  app.post('/api/system/restart', guard, async (req) => {
    await app.prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', restartRequestedAt: new Date() },
      update: { restartRequestedAt: new Date() },
    });
    await app.prisma.auditLog
      .create({
        data: {
          adminUserId: req.user.sub,
          action: 'system.restart',
          entityType: 'app_settings',
          entityId: 'singleton',
        },
      })
      .catch(() => undefined);
    // Give the response time to flush, then exit; the Swarm restart_policy
    // recreates the container, re-reading the connection overrides at boot.
    setTimeout(() => process.exit(0), 800);
    return { ok: true };
  });
}
