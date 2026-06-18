import { logger, AMQP } from '@wootrico/config';
import { prisma } from '@wootrico/db';
import { consume, closeQueue } from '@wootrico/queue';
import { closeRedis } from '@wootrico/cache';
import { assertLicenseActive, runHeartbeat } from '@wootrico/license-client';
import { handleInbound } from './handlers/inbound.js';
import { handleChatwootCallback } from './handlers/chatwoot-callback.js';
import { runCleanup } from './jobs/cleanup.js';

const HEARTBEAT_MS = 6 * 60 * 60 * 1000; // 6h
const CLEANUP_MS = 60 * 60 * 1000; // 1h

async function main() {
  await consume(
    AMQP.queues.inbound,
    async (job) => {
      const gate = await assertLicenseActive();
      if (!gate.allowed) {
        logger.warn({ status: gate.status }, 'inbound dropped: license not active');
        return;
      }
      await handleInbound(job.payload, job.integrationId);
    },
    { prefetch: 16 },
  );

  await consume(
    AMQP.queues.callback,
    async (job) => {
      const gate = await assertLicenseActive();
      if (!gate.allowed) {
        logger.warn({ status: gate.status }, 'callback dropped: license not active');
        return;
      }
      await handleChatwootCallback(job.payload, job.integrationId);
    },
    { prefetch: 16 },
  );

  // Periodic jobs (no broker needed): license heartbeat + TTL cleanup.
  const heartbeatTimer = setInterval(() => {
    void runHeartbeat().catch((err) => logger.warn({ err }, 'heartbeat failed'));
  }, HEARTBEAT_MS);
  const cleanupTimer = setInterval(() => {
    void runCleanup().catch((err) => logger.warn({ err }, 'cleanup failed'));
  }, CLEANUP_MS);
  await runHeartbeat().catch((err) => logger.warn({ err }, 'initial heartbeat failed'));
  await runCleanup().catch((err) => logger.warn({ err }, 'initial cleanup failed'));

  logger.info('worker started; consuming inbound + callback (RabbitMQ) + heartbeat/cleanup timers');

  const close = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    clearInterval(heartbeatTimer);
    clearInterval(cleanupTimer);
    await closeQueue();
    await closeRedis();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));
}

void main().catch((err) => {
  logger.error(err, 'worker failed to start');
  process.exit(1);
});
