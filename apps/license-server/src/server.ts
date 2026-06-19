import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { pino } from 'pino';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { cfg } from './env.js';
import { prisma } from './db.js';
import { generateKey, hashKey, signToken } from './crypto.js';
import {
  adminLoginConfigured,
  checkAdminCredentials,
  signAdminToken,
  verifyAdminToken,
} from './admin-auth.js';

const logger = pino(
  cfg.nodeEnv === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } } }
    : {},
);

const app = Fastify({ loggerInstance: logger as never, trustProxy: true });

// Tolerate bodyless POSTs (e.g. /admin/keys/:id/revoke) and empty JSON bodies.
const jsonParser = (
  _req: unknown,
  payload: NodeJS.ReadableStream,
  done: (e: Error | null, body?: unknown) => void,
) => {
  let data = '';
  payload.on('data', (c) => (data += c));
  payload.on('end', () => {
    try {
      done(null, data ? JSON.parse(data) : {});
    } catch {
      done(null, {});
    }
  });
};
app.removeContentTypeParser('application/json');
app.addContentTypeParser('*', jsonParser as never);

/** Client IP, honoring X-Forwarded-For (trustProxy is enabled). LGPD-safe metadata. */
function clientIp(req: FastifyRequest): string | undefined {
  return req.ip || undefined;
}

/** Record an LGPD-safe access/usage event (metadata only — never message content). */
async function recordEvent(opts: {
  type: string;
  licenseKeyId?: string | null;
  instanceId?: string | null;
  ip?: string | null;
  appVersion?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.licenseEvent.create({
      data: {
        type: opts.type,
        licenseKeyId: opts.licenseKeyId ?? null,
        instanceId: opts.instanceId ?? null,
        ip: opts.ip ?? null,
        appVersion: opts.appVersion ?? null,
        meta: (opts.meta ?? undefined) as never,
      },
    });
  } catch (err) {
    logger.warn({ err }, 'failed to record license event');
  }
}

const ProvisionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().optional(),
  instanceId: z.string().min(1),
  appVersion: z.string().optional(),
  publicBaseUrl: z.string().optional(),
});
const ActivateSchema = z.object({
  key: z.string().min(1),
  instanceId: z.string().min(1),
  appVersion: z.string().optional(),
  publicBaseUrl: z.string().optional(),
});
const HeartbeatSchema = z.object({
  key: z.string().min(1),
  instanceId: z.string().min(1),
  token: z.string().optional(),
  telemetry: z.record(z.unknown()).optional(),
});
const DeactivateSchema = z.object({ key: z.string().min(1), instanceId: z.string().min(1) });

app.get('/health', async () => ({ status: 'ok' }));

// ── provision (self-service: create + bind a key in one online call) ──
app.post('/provision', async (req, reply) => {
  const p = ProvisionSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const { name, email, instanceId, appVersion, publicBaseUrl } = p.data;
  const ip = clientIp(req);

  // Rule: one active key per instanceId. If this instance already has a live
  // activation, re-sign its token instead of minting a second key.
  const existing = await prisma.activation.findFirst({
    where: { instanceId, revokedAt: null, licenseKey: { revokedAt: null } },
    include: { licenseKey: true },
  });
  if (existing) {
    await prisma.activation.update({
      where: { id: existing.id },
      data: { lastHeartbeatAt: new Date(), lastIp: ip, appVersion, publicBaseUrl },
    });
    const token = await signToken({
      instanceId,
      keyId: existing.licenseKeyId,
      features: existing.licenseKey.features as never,
    });
    if (existing.lastIp && ip && existing.lastIp !== ip) {
      await recordEvent({
        type: 'ip_changed',
        licenseKeyId: existing.licenseKeyId,
        instanceId,
        ip,
        appVersion,
        meta: { previousIp: existing.lastIp },
      });
    }
    await recordEvent({
      type: 'provision_reused',
      licenseKeyId: existing.licenseKeyId,
      instanceId,
      ip,
      appVersion,
    });
    return { token, features: existing.licenseKey.features ?? {}, reused: true };
  }

  const raw = generateKey();
  const lk = await prisma.licenseKey.create({
    data: {
      keyHash: hashKey(raw),
      plan: 'pro',
      email,
      name,
      provisionedBy: 'self-service',
      features: {} as never,
      maxActivations: 1,
    },
  });
  await prisma.activation.create({
    data: {
      licenseKeyId: lk.id,
      instanceId,
      appVersion,
      publicBaseUrl,
      firstIp: ip,
      lastIp: ip,
      lastHeartbeatAt: new Date(),
    },
  });
  const token = await signToken({ instanceId, keyId: lk.id, features: lk.features as never });
  await recordEvent({ type: 'provision', licenseKeyId: lk.id, instanceId, ip, appVersion });
  return { key: raw, token, features: lk.features ?? {} };
});

// ── activate ──
app.post('/activate', async (req, reply) => {
  const p = ActivateSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const { key, instanceId, appVersion, publicBaseUrl } = p.data;
  const ip = clientIp(req);

  const lk = await prisma.licenseKey.findUnique({ where: { keyHash: hashKey(key) } });
  if (!lk) return reply.code(404).send({ error: 'invalid_key' });
  // Only MANUAL blocking applies: a revoked key cannot activate.
  if (lk.revokedAt) {
    await recordEvent({ type: 'activate_revoked', licenseKeyId: lk.id, instanceId, ip, appVersion });
    return reply.code(403).send({ error: 'revoked' });
  }

  // No activation limit: a user may run as many instances as they want on any
  // machine. We only record usage (and flag IP changes) for visibility.
  const prev = await prisma.activation.findUnique({
    where: { licenseKeyId_instanceId: { licenseKeyId: lk.id, instanceId } },
  });

  await prisma.activation.upsert({
    where: { licenseKeyId_instanceId: { licenseKeyId: lk.id, instanceId } },
    create: {
      licenseKeyId: lk.id,
      instanceId,
      appVersion,
      publicBaseUrl,
      firstIp: ip,
      lastIp: ip,
      lastHeartbeatAt: new Date(),
    },
    update: { appVersion, publicBaseUrl, lastIp: ip, revokedAt: null, lastHeartbeatAt: new Date() },
  });

  if (prev?.lastIp && ip && prev.lastIp !== ip) {
    await recordEvent({
      type: 'ip_changed',
      licenseKeyId: lk.id,
      instanceId,
      ip,
      appVersion,
      meta: { previousIp: prev.lastIp },
    });
  }

  const token = await signToken({ instanceId, keyId: lk.id, features: lk.features as never });
  await recordEvent({ type: 'activate', licenseKeyId: lk.id, instanceId, ip, appVersion });
  return { token, features: lk.features ?? {} };
});

// ── heartbeat ──
app.post('/heartbeat', async (req, reply) => {
  const p = HeartbeatSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const { key, instanceId, telemetry } = p.data;
  const ip = clientIp(req);
  const appVersion = typeof telemetry?.appVersion === 'string' ? telemetry.appVersion : undefined;

  const lk = await prisma.licenseKey.findUnique({ where: { keyHash: hashKey(key) } });
  if (!lk || lk.revokedAt) return reply.send({ revoked: true });

  const activation = await prisma.activation.findUnique({
    where: { licenseKeyId_instanceId: { licenseKeyId: lk.id, instanceId } },
  });
  if (!activation || activation.revokedAt) return reply.send({ revoked: true });

  await prisma.activation.update({
    where: { id: activation.id },
    data: { lastHeartbeatAt: new Date(), lastIp: ip, lastTelemetry: (telemetry ?? {}) as never },
  });
  if (activation.lastIp && ip && activation.lastIp !== ip) {
    await recordEvent({
      type: 'ip_changed',
      licenseKeyId: lk.id,
      instanceId,
      ip,
      appVersion,
      meta: { previousIp: activation.lastIp },
    });
  }
  await recordEvent({ type: 'heartbeat', licenseKeyId: lk.id, instanceId, ip, appVersion });

  const token = await signToken({ instanceId, keyId: lk.id, features: lk.features as never });
  return { token, features: lk.features ?? {} };
});

// ── deactivate (release binding) ──
app.post('/deactivate', async (req, reply) => {
  const p = DeactivateSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const ip = clientIp(req);
  const lk = await prisma.licenseKey.findUnique({ where: { keyHash: hashKey(p.data.key) } });
  if (lk) {
    await prisma.activation.updateMany({
      where: { licenseKeyId: lk.id, instanceId: p.data.instanceId },
      data: { revokedAt: new Date() },
    });
    await recordEvent({
      type: 'deactivate',
      licenseKeyId: lk.id,
      instanceId: p.data.instanceId,
      ip,
    });
  }
  return { ok: true };
});

// ── admin ──
/** Accept either the static ADMIN_TOKEN (scripts/CLI) or a panel JWT session. */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (token && token === cfg.adminToken) return true;
  if (token && (await verifyAdminToken(token))) return true;
  reply.code(401).send({ error: 'unauthorized' });
  return false;
}

const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

app.post('/admin/login', async (req, reply) => {
  if (!adminLoginConfigured()) return reply.code(503).send({ error: 'login_not_configured' });
  const p = AdminLoginSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  if (!checkAdminCredentials(p.data.email, p.data.password)) {
    return reply.code(401).send({ error: 'invalid_credentials' });
  }
  const token = await signAdminToken(p.data.email);
  return { token, user: { email: p.data.email } };
});

app.get('/admin/me', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return { ok: true };
});

const CreateKeySchema = z.object({
  plan: z.string().optional(),
  email: z.string().email().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  features: z.record(z.unknown()).optional(),
  maxActivations: z.number().int().positive().optional(),
});

app.post('/admin/keys', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const p = CreateKeySchema.safeParse(req.body ?? {});
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const raw = generateKey();
  const created = await prisma.licenseKey.create({
    data: {
      keyHash: hashKey(raw),
      plan: p.data.plan ?? 'pro',
      email: p.data.email,
      name: p.data.name,
      provisionedBy: 'admin',
      features: (p.data.features ?? {}) as never,
      maxActivations: p.data.maxActivations ?? 1,
    },
  });
  await recordEvent({ type: 'admin_create', licenseKeyId: created.id });
  return reply.code(201).send({ id: created.id, key: raw });
});

const KeysQuerySchema = z.object({
  q: z.string().trim().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

app.get('/admin/keys', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const query = KeysQuerySchema.safeParse(req.query ?? {});
  if (!query.success) return reply.code(400).send({ error: 'validation' });
  const { q, from, to } = query.data;

  // Date range on createdAt.
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from) createdAt.gte = new Date(from);
  if (to) createdAt.lte = new Date(to);

  // Search by name/email (contains) OR by license id OR by the raw key (hashed).
  const or: import('../generated/client/index.js').Prisma.LicenseKeyWhereInput[] = [];
  if (q) {
    or.push({ name: { contains: q, mode: 'insensitive' } });
    or.push({ email: { contains: q, mode: 'insensitive' } });
    or.push({ id: q });
    if (q.startsWith('WTR-')) or.push({ keyHash: hashKey(q) });
  }

  const keys = await prisma.licenseKey.findMany({
    where: {
      ...(from || to ? { createdAt } : {}),
      ...(or.length ? { OR: or } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { activations: true } },
      activations: {
        orderBy: { lastHeartbeatAt: 'desc' },
        select: {
          id: true,
          instanceId: true,
          appVersion: true,
          publicBaseUrl: true,
          firstIp: true,
          lastIp: true,
          boundAt: true,
          lastHeartbeatAt: true,
          revokedAt: true,
        },
      },
    },
  });

  return {
    keys: keys.map((k) => {
      const liveBindings = k.activations.filter((a) => !a.revokedAt);
      const live = liveBindings[0] ?? k.activations[0];
      const distinctIps = new Set(
        k.activations.map((a) => a.lastIp ?? a.firstIp).filter(Boolean) as string[],
      );
      const activeInstances = liveBindings.length;
      return {
        id: k.id,
        plan: k.plan,
        email: k.email,
        name: k.name,
        provisionedBy: k.provisionedBy,
        revoked: !!k.revokedAt,
        activations: k._count.activations,
        activeInstances,
        distinctIps: distinctIps.size,
        // Informational warning only — never an automatic block.
        warning: distinctIps.size > 1 || activeInstances > 1,
        lastIp: live?.lastIp ?? null,
        lastHeartbeatAt: live?.lastHeartbeatAt ?? null,
        createdAt: k.createdAt,
        bindings: k.activations,
      };
    }),
  };
});

app.post('/admin/keys/:id/revoke', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  await prisma.licenseKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await recordEvent({ type: 'admin_revoke', licenseKeyId: id });
  return { ok: true };
});

app.post('/admin/keys/:id/activate', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  await prisma.licenseKey.update({ where: { id }, data: { revokedAt: null } });
  await recordEvent({ type: 'admin_activate', licenseKeyId: id });
  return { ok: true };
});

const EventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  before: z.string().optional(),
  keyId: z.string().optional(),
  type: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

app.get('/admin/events', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const q = EventsQuerySchema.safeParse(req.query ?? {});
  if (!q.success) return reply.code(400).send({ error: 'validation' });
  const limit = q.data.limit ?? 50;
  const before = q.data.before ? new Date(q.data.before) : undefined;
  const createdAt: { lt?: Date; gte?: Date; lte?: Date } = {};
  if (before) createdAt.lt = before;
  if (q.data.from) createdAt.gte = new Date(q.data.from);
  if (q.data.to) createdAt.lte = new Date(q.data.to);
  const events = await prisma.licenseEvent.findMany({
    where: {
      ...(q.data.keyId ? { licenseKeyId: q.data.keyId } : {}),
      ...(q.data.type ? { type: q.data.type } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });
  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;
  return {
    events: page,
    nextBefore: hasMore ? page[page.length - 1]?.createdAt.toISOString() : null,
  };
});

app.get('/admin/keys/:id/events', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  const events = await prisma.licenseEvent.findMany({
    where: { licenseKeyId: id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return { events };
});

// ── admin SPA (license-admin-web build) ──
// Registered LAST so API routes take precedence. No-op in dev (the admin SPA
// runs on its own Vite dev server). Resolved from process.cwd() to work in both
// dev (cwd=apps/license-server) and prod (cwd=/app, the Docker workdir).
async function registerAdminSpa(): Promise<void> {
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, 'apps/license-admin-web/dist'),
    resolve(cwd, '../license-admin-web/dist'),
    resolve(cwd, 'license-admin-web/dist'),
  ];
  const root = candidates.find((p) => existsSync(join(p, 'index.html')));
  if (!root) {
    logger.warn('license-admin-web build not found; admin SPA will not be served (dev mode).');
    return;
  }
  await app.register(fastifyStatic, { root, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (
      req.url.startsWith('/admin/') ||
      req.url.startsWith('/activate') ||
      req.url.startsWith('/heartbeat') ||
      req.url.startsWith('/deactivate') ||
      req.url.startsWith('/provision') ||
      req.url.startsWith('/health')
    ) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile('index.html');
  });
}

async function main() {
  try {
    await registerAdminSpa();
    await app.listen({ port: cfg.port, host: cfg.host });
  } catch (err) {
    logger.error(err, 'license-server failed to start');
    process.exit(1);
  }
}
void main();
