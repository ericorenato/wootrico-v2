import amqplib, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { AMQP, env, logger } from '@wootrico/config';

/**
 * The job carried by the broker. The raw webhook payload travels INSIDE the
 * message (ephemeral, dropped after ack) — it is never persisted in Postgres.
 */
export interface WebhookJob {
  integrationId: string;
  source: 'provider' | 'chatwoot';
  payload: unknown;
  receivedAt: string;
}

let connection: ChannelModel | undefined;
let connecting: Promise<ChannelModel> | undefined;
let pubChannel: Channel | undefined;

// Set true by closeQueue() so a deliberate shutdown doesn't trigger the
// reconnect loop (which would fight process.exit).
let closing = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempts = 0;

/**
 * Registered consumers. amqplib does NOT auto-reconnect, and a dropped
 * connection silently kills every consumer while the process keeps running its
 * other timers — so we remember each registration and re-establish it whenever
 * the connection (or its channel) comes back. Without this, one broker blip
 * stops all message processing until the worker is manually restarted.
 */
interface ConsumerReg {
  queueName: string;
  handler: (job: WebhookJob) => Promise<void>;
  opts: ConsumeOptions;
  channel?: Channel;
}
const consumers: ConsumerReg[] = [];

// Optional runtime override of the broker URL (set at boot from DB settings,
// taking precedence over the env var). Empty/undefined falls back to env.
let urlOverride: string | undefined;
export function setRabbitUrl(url?: string): void {
  urlOverride = url && url.trim() ? url.trim() : undefined;
}
export function effectiveRabbitUrl(): string {
  return urlOverride ?? env.RABBITMQ_URL;
}

export async function getConnection(): Promise<ChannelModel> {
  if (connection) return connection;
  // Coalesce concurrent callers onto a single connect attempt.
  if (connecting) return connecting;
  connecting = (async () => {
    const conn = await amqplib.connect(effectiveRabbitUrl());
    conn.on('error', (err) => logger.error({ err }, 'amqp connection error'));
    conn.on('close', () => {
      const wasConnected = connection !== undefined;
      connection = undefined;
      pubChannel = undefined;
      for (const c of consumers) c.channel = undefined;
      if (closing) return;
      logger.warn('amqp connection closed');
      // Only drive a reconnect when there are consumers to restore. The publish
      // side heals lazily (publisher() re-creates the channel on the next send).
      if (wasConnected && consumers.length > 0) scheduleReconnect();
    });
    connection = conn;
    return conn;
  })();
  try {
    return await connecting;
  } finally {
    connecting = undefined;
  }
}

/** Reconnect with capped exponential backoff, then re-establish all consumers. */
function scheduleReconnect(): void {
  if (closing || reconnectTimer) return;
  const base = Math.min(1000 * 2 ** reconnectAttempts, 30_000);
  const delay = base * (0.5 + Math.random() * 0.5); // jitter to avoid thundering herd
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void reestablishConsumers();
  }, delay);
}

async function reestablishConsumers(): Promise<void> {
  if (closing || consumers.length === 0) return;
  try {
    await getConnection();
    for (const reg of consumers) {
      if (!reg.channel) await startConsumer(reg);
    }
    reconnectAttempts = 0; // recovered — reset backoff
    logger.info('amqp reconnected — consumers re-established');
  } catch (err) {
    logger.warn({ err }, 'amqp reconnect failed — retrying');
    scheduleReconnect();
  }
}

/** Declare all exchanges/queues/bindings. Idempotent — safe to call on boot. */
export async function assertTopology(ch: Channel): Promise<void> {
  await ch.assertExchange(AMQP.exchange, 'direct', { durable: true });
  await ch.assertExchange(AMQP.retryExchange, 'fanout', { durable: true });
  await ch.assertExchange(AMQP.dlxExchange, 'fanout', { durable: true });

  // work queues (quorum = durable/replicated), dead-letter to DLX on reject
  for (const [key, queue] of [
    [AMQP.routingKeys.inbound, AMQP.queues.inbound],
    [AMQP.routingKeys.callback, AMQP.queues.callback],
  ] as const) {
    await ch.assertQueue(queue, {
      durable: true,
      arguments: { 'x-queue-type': 'quorum', 'x-dead-letter-exchange': AMQP.dlxExchange },
    });
    await ch.bindQueue(queue, AMQP.exchange, key);
  }

  // retry queue: holds messages for retryTtlMs then dead-letters back to the
  // main exchange, preserving the original routing key (fanout keeps it).
  await ch.assertQueue(AMQP.queues.retry, {
    durable: true,
    arguments: {
      'x-message-ttl': AMQP.retryTtlMs,
      'x-dead-letter-exchange': AMQP.exchange,
    },
  });
  await ch.bindQueue(AMQP.queues.retry, AMQP.retryExchange, '');

  // dead-letter sink (poison messages)
  await ch.assertQueue(AMQP.queues.dead, { durable: true });
  await ch.bindQueue(AMQP.queues.dead, AMQP.dlxExchange, '');
}

async function publisher(): Promise<Channel> {
  if (pubChannel) return pubChannel;
  const conn = await getConnection();
  const ch = await conn.createChannel();
  ch.on('error', (err) => logger.error({ err }, 'amqp publish channel error'));
  ch.on('close', () => {
    if (pubChannel === ch) pubChannel = undefined;
  });
  await assertTopology(ch);
  pubChannel = ch;
  return ch;
}

/** Publish a webhook job (ingress side). */
export async function publishWebhook(job: WebhookJob): Promise<void> {
  const ch = await publisher();
  const rk = job.source === 'provider' ? AMQP.routingKeys.inbound : AMQP.routingKeys.callback;
  ch.publish(AMQP.exchange, rk, Buffer.from(JSON.stringify(job)), {
    persistent: true,
    contentType: 'application/json',
  });
}

export interface ConsumeOptions {
  /** max concurrent unacked messages per consumer */
  prefetch?: number;
}

/**
 * Decide whether a failed job is worth retrying. Permanent client errors (4xx
 * from Chatwoot/provider — bad payload, validation, not-found) will never
 * succeed on retry and only amplify load and the duplicate window, so they go
 * straight to the dead-letter. Transient conditions (5xx, network, timeout,
 * rate-limit) are retried.
 */
function isRetryable(err: unknown): boolean {
  const status = (err as { response?: { status?: number }; status?: number } | undefined)?.response
    ?.status ?? (err as { status?: number } | undefined)?.status;
  if (typeof status === 'number') {
    if (status === 408 || status === 429) return true; // timeout / rate-limit
    if (status >= 400 && status < 500) return false; // permanent client error
  }
  return true; // 5xx, network errors, timeouts, unknown
}

/** Open a channel and start delivering `queueName` to the registered handler. */
async function startConsumer(reg: ConsumerReg): Promise<void> {
  const conn = await getConnection();
  const ch = await conn.createChannel();
  await assertTopology(ch);
  await ch.prefetch(reg.opts.prefetch ?? 8);

  ch.on('error', (err) =>
    logger.error({ err, queue: reg.queueName }, 'amqp consumer channel error'),
  );
  ch.on('close', () => {
    if (reg.channel !== ch) return;
    reg.channel = undefined;
    // If the whole connection dropped, its 'close' handler drives the reconnect.
    // If only THIS channel died (e.g. a nack storm), restore just this consumer.
    if (!closing && connection) {
      logger.warn({ queue: reg.queueName }, 'consumer channel closed — restarting');
      void startConsumer(reg).catch((err) =>
        logger.warn({ err, queue: reg.queueName }, 'failed to restart consumer channel'),
      );
    }
  });

  await ch.consume(reg.queueName, async (msg: ConsumeMessage | null) => {
    if (!msg) return;
    const retries = (msg.properties.headers?.['x-retries'] as number | undefined) ?? 0;
    try {
      const job = JSON.parse(msg.content.toString()) as WebhookJob;
      await reg.handler(job);
      ch.ack(msg);
    } catch (err) {
      if (!isRetryable(err)) {
        logger.error({ err }, 'job failed with non-retryable error -> dead-letter');
        ch.nack(msg, false, false); // -> DLX -> dead queue
      } else if (retries < AMQP.maxRetries) {
        // Re-publish to the retry exchange using the ORIGINAL routing key. The
        // retry queue (fanout-bound) receives it regardless, but the message
        // keeps the routing key so DLX-on-TTL-expiry routes it back to the
        // correct work queue (inbound/callback).
        ch.publish(AMQP.retryExchange, msg.fields.routingKey, msg.content, {
          persistent: true,
          contentType: 'application/json',
          headers: { ...msg.properties.headers, 'x-retries': retries + 1 },
        });
        logger.warn({ err, retries }, `job failed, scheduled retry ${retries + 1}/${AMQP.maxRetries}`);
        ch.ack(msg);
      } else {
        logger.error({ err }, 'job exhausted retries -> dead-letter');
        ch.nack(msg, false, false); // -> DLX -> dead queue
      }
    }
  });

  reg.channel = ch;
}

/**
 * Consume a queue with manual ack + bounded retry (via the retry queue) and a
 * dead-letter sink for poison messages. The registration survives connection
 * drops: consumers are automatically re-established on reconnect.
 */
export async function consume(
  queueName: string,
  handler: (job: WebhookJob) => Promise<void>,
  opts: ConsumeOptions = {},
): Promise<Channel> {
  const reg: ConsumerReg = { queueName, handler, opts };
  consumers.push(reg);
  await startConsumer(reg);
  return reg.channel as Channel;
}

export interface PingResult {
  ok: boolean;
  detail?: string;
}

/** Open (or reuse) the active connection and a channel to prove the broker is
 *  reachable AND the credentials are accepted (auth failures surface here). */
export async function pingRabbit(): Promise<PingResult> {
  try {
    const conn = await getConnection();
    const ch = await conn.createChannel();
    await ch.close();
    return { ok: true, detail: 'connection + channel ok' };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

/** Connect to an arbitrary AMQP URL, open a channel, and close it. Validates a
 *  new connection string (incl. credentials) BEFORE persisting it. */
export async function testRabbitUrl(url: string): Promise<PingResult> {
  let conn: ChannelModel | undefined;
  try {
    conn = await amqplib.connect(url, { timeout: 8000 });
    const ch = await conn.createChannel();
    await ch.close();
    return { ok: true, detail: 'connection + channel ok' };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  } finally {
    if (conn) await conn.close().catch(() => undefined);
  }
}

export async function closeQueue(): Promise<void> {
  closing = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  for (const reg of consumers) {
    try {
      await reg.channel?.close();
    } catch {
      /* ignore */
    }
    reg.channel = undefined;
  }
  try {
    await pubChannel?.close();
  } catch {
    /* ignore */
  }
  try {
    await connection?.close();
  } catch {
    /* ignore */
  }
  connection = undefined;
  pubChannel = undefined;
}

export { AMQP };
