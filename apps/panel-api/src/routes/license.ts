import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  activateLicense,
  deactivateLicense,
  evaluateLicense,
  getLicenseState,
  runHeartbeat,
  LicenseError,
} from '@wootrico/license-client';

const ActivateSchema = z.object({ licenseKey: z.string().min(1) });

export default async function licenseRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] };

  app.get('/api/license/status', guard, async () => {
    const status = await evaluateLicense();
    const state = await getLicenseState();
    return {
      status,
      instanceId: state.instanceId,
      features: state.features ?? {},
      tokenExpiresAt: state.tokenExpiresAt,
      graceUntil: state.graceUntil,
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastError: state.lastError,
      serverUrl: process.env.LICENSE_SERVER_URL,
    };
  });

  app.post('/api/license/activate', guard, async (req, reply) => {
    const p = ActivateSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'validation' });
    try {
      const result = await activateLicense(p.data.licenseKey);
      await app.prisma.auditLog.create({
        data: { adminUserId: req.user.sub, action: 'license.activated', entityType: 'license' },
      });
      return result;
    } catch (err) {
      if (err instanceof LicenseError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post('/api/license/heartbeat', guard, async () => {
    return runHeartbeat();
  });

  app.post('/api/license/deactivate', guard, async (req, reply) => {
    await deactivateLicense();
    await app.prisma.auditLog.create({
      data: { adminUserId: req.user.sub, action: 'license.deactivated', entityType: 'license' },
    });
    return reply.code(204).send();
  });
}
