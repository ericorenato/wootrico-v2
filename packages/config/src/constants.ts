/** Shared constants across apps and packages. */

export const PROVIDER_TYPES = ['evolution', 'uazapi', 'zapi'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const MESSAGE_TYPES = ['text', 'image', 'audio', 'video', 'document'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const CONVERSATION_STATUSES = ['open', 'resolved', 'pending'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const LICENSE_STATUSES = [
  'unactivated',
  'active',
  'warning',
  'grace',
  'blocked',
] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

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

/** License timing (instance side). */
export const LICENSE = {
  heartbeatIntervalMs: 6 * 60 * 60 * 1000, // 6h
  tokenTtlDays: 14,
  graceDays: 7,
} as const;

/** TTLs for cleanup sweeps. */
export const TTL = {
  messageMappingDays: 30,
  dedupTicketMinutes: 10,
  webhookEventDays: 14,
} as const;
