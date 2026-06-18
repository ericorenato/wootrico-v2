import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { env } from '@wootrico/config';

let redis: Redis | undefined;

export function getRedis(): Redis {
  if (redis) return redis;
  redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => undefined);
    redis = undefined;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────── distributed lock ───────────────────────────

const UNLOCK = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/**
 * Run `fn` while holding a Redis lock on `key`. Used to serialize processing per
 * conversation so messages stay ordered (replaces the old fixed delay).
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; waitMs?: number; retryMs?: number } = {},
): Promise<T> {
  const r = getRedis();
  const token = randomBytes(16).toString('hex');
  const ttl = opts.ttlMs ?? 30_000;
  const wait = opts.waitMs ?? 15_000;
  const retry = opts.retryMs ?? 100;
  const deadline = Date.now() + wait;

  // acquire
  while (true) {
    const ok = await r.set(key, token, 'PX', ttl, 'NX');
    if (ok) break;
    if (Date.now() > deadline) throw new Error(`lock timeout: ${key}`);
    await sleep(retry);
  }
  try {
    return await fn();
  } finally {
    await r.eval(UNLOCK, 1, key, token).catch(() => undefined);
  }
}

// ─────────────────────────── json cache ───────────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  const v = await getRedis().get(key);
  return v ? (JSON.parse(v) as T) : null;
}

export async function cacheSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  await getRedis().set(key, JSON.stringify(value), 'EX', ttlSec);
}

export async function cacheDel(key: string): Promise<void> {
  await getRedis().del(key);
}

/** get-or-compute with TTL. */
export async function cached<T>(key: string, ttlSec: number, compute: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await compute();
  if (value !== null && value !== undefined) await cacheSet(key, value, ttlSec);
  return value;
}

// ─────────────────────────── throttle (pacing) ───────────────────────────

// Atomically schedule the next allowed timestamp and return ms to wait.
const THROTTLE = `
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local last = tonumber(redis.call('get', KEYS[1]) or '0')
local nextAt = math.max(now, last + interval)
redis.call('set', KEYS[1], nextAt, 'PX', interval * 5)
return nextAt - now`;

/** Pace operations on `key` to at most one per `intervalMs` (sleeps as needed). */
export async function throttle(key: string, intervalMs: number): Promise<void> {
  const waitMs = (await getRedis().eval(THROTTLE, 1, key, Date.now().toString(), intervalMs.toString())) as number;
  if (waitMs > 0) await sleep(waitMs);
}
