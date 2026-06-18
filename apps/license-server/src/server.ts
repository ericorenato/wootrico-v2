import Fastify from 'fastify';
import { z } from 'zod';
import { pino } from 'pino';
import { cfg } from './env.js';
import { prisma } from './db.js';
import { generateKey, hashKey, signToken } from './crypto.js';

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

// ── activate ──
app.post('/activate', async (req, reply) => {
  const p = ActivateSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const { key, instanceId, appVersion, publicBaseUrl } = p.data;

  const lk = await prisma.licenseKey.findUnique({ where: { keyHash: hashKey(key) } });
  if (!lk) return reply.code(404).send({ error: 'invalid_key' });
  if (lk.revokedAt) return reply.code(403).send({ error: 'revoked' });

  const activations = await prisma.activation.findMany({
    where: { licenseKeyId: lk.id, revokedAt: null },
  });
  const boundElsewhere = activations.find((a) => a.instanceId !== instanceId);
  if (boundElsewhere && activations.length >= lk.maxActivations) {
    return reply.code(409).send({ error: 'activation_limit' });
  }

  await prisma.activation.upsert({
    where: { licenseKeyId_instanceId: { licenseKeyId: lk.id, instanceId } },
    create: { licenseKeyId: lk.id, instanceId, appVersion, publicBaseUrl, lastHeartbeatAt: new Date() },
    update: { appVersion, publicBaseUrl, revokedAt: null, lastHeartbeatAt: new Date() },
  });

  const token = await signToken({ instanceId, keyId: lk.id, features: lk.features as never });
  return { token, features: lk.features ?? {} };
});

// ── heartbeat ──
app.post('/heartbeat', async (req, reply) => {
  const p = HeartbeatSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const { key, instanceId, telemetry } = p.data;

  const lk = await prisma.licenseKey.findUnique({ where: { keyHash: hashKey(key) } });
  if (!lk || lk.revokedAt) return reply.send({ revoked: true });

  const activation = await prisma.activation.findUnique({
    where: { licenseKeyId_instanceId: { licenseKeyId: lk.id, instanceId } },
  });
  if (!activation || activation.revokedAt) return reply.send({ revoked: true });

  await prisma.activation.update({
    where: { id: activation.id },
    data: { lastHeartbeatAt: new Date(), lastTelemetry: (telemetry ?? {}) as never },
  });
  await prisma.heartbeatLog.create({
    data: { licenseKeyId: lk.id, instanceId, telemetry: (telemetry ?? {}) as never },
  });

  const token = await signToken({ instanceId, keyId: lk.id, features: lk.features as never });
  return { token, features: lk.features ?? {} };
});

// ── deactivate (release binding) ──
app.post('/deactivate', async (req, reply) => {
  const p = DeactivateSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const lk = await prisma.licenseKey.findUnique({ where: { keyHash: hashKey(p.data.key) } });
  if (lk) {
    await prisma.activation.updateMany({
      where: { licenseKeyId: lk.id, instanceId: p.data.instanceId },
      data: { revokedAt: new Date() },
    });
  }
  return { ok: true };
});

// ── admin ──
function requireAdmin(req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): boolean {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${cfg.adminToken}`) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

const CreateKeySchema = z.object({
  plan: z.string().optional(),
  email: z.string().email().optional(),
  features: z.record(z.unknown()).optional(),
  maxActivations: z.number().int().positive().optional(),
});

app.post('/admin/keys', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const p = CreateKeySchema.safeParse(req.body ?? {});
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const raw = generateKey();
  const created = await prisma.licenseKey.create({
    data: {
      keyHash: hashKey(raw),
      plan: p.data.plan ?? 'pro',
      email: p.data.email,
      features: (p.data.features ?? {}) as never,
      maxActivations: p.data.maxActivations ?? 1,
    },
  });
  return reply.code(201).send({ id: created.id, key: raw });
});

app.get('/admin/keys', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const keys = await prisma.licenseKey.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { activations: true } } },
  });
  return {
    keys: keys.map((k) => ({
      id: k.id,
      plan: k.plan,
      email: k.email,
      maxActivations: k.maxActivations,
      revoked: !!k.revokedAt,
      activations: k._count.activations,
      createdAt: k.createdAt,
    })),
  };
});

app.post('/admin/keys/:id/revoke', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const { id } = req.params as { id: string };
  await prisma.licenseKey.update({ where: { id }, data: { revokedAt: new Date() } });
  return { ok: true };
});

async function main() {
  try {
    await app.listen({ port: cfg.port, host: cfg.host });
  } catch (err) {
    logger.error(err, 'license-server failed to start');
    process.exit(1);
  }
}
void main();
