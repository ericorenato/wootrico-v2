/** Shared constants across apps and packages. */

export const PROVIDER_TYPES = ['evolution', 'uazapi', 'zapi'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const MESSAGE_TYPES = ['text', 'image', 'audio', 'video', 'document'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const CONVERSATION_STATUSES = ['open', 'resolved', 'pending'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const LICENSE_STATUSES = ['unactivated', 'active', 'warning', 'blocked'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const LICENSE_PLANS = ['trial', 'paid'] as const;
export type LicensePlan = (typeof LICENSE_PLANS)[number];

/** RabbitMQ topology names. */
export const AMQP = {
  exchange: 'wootrico', // direct
  retryExchange: 'wootrico.retry', // fanout -> retry queue
  dlxExchange: 'wootrico.dlx', // fanout -> dead queue
  queues: {
    inbound: 'wootrico.inbound',
    callback: 'wootrico.callback',
    retry: 'wootrico.retry.q',
    dead: 'wootrico.dead',
  },
  routingKeys: {
    inbound: 'inbound',
    callback: 'callback',
  },
  retryTtlMs: 10_000,
  maxRetries: 5,
} as const;

/** License timing (instance side). Validation is fully online. */
export const LICENSE = {
  // How often the instance re-checks "is my key still active?" with the server.
  validateIntervalMs: 30 * 60 * 1000, // 30 min
  // How long a last-known-good "active" answer is trusted when the server is
  // unreachable, before flipping to blocked. Tolerates brief outages only.
  cacheGraceMs: 6 * 60 * 60 * 1000, // 6h
} as const;

/** TTLs for cleanup sweeps. */
export const TTL = {
  messageMappingDays: 30,
  dedupTicketMinutes: 10,
  webhookEventDays: 14,
} as const;
