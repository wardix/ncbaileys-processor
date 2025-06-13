export const NATS_SERVERS = process.env.NATS_SERVERS || 'nats://localhost:4222'
export const NATS_TOKEN = process.env.NATS_TOKEN || ''
export const MAX_BACKOFF_DELAY_SECONDS =
  process.env.MAX_BACKOFF_DELAY_SECONDS || 8
export const MIN_BACKOFF_DELAY_SECONDS =
  process.env.MIN_BACKOFF_DELAY_SECONDS || 1
export const WABA_MESSAGE_TEMPLATE = process.env.WABA_MESSAGE_TEMPLATE || ''
export const WABA_WEBHOOK_CONFIG = process.env.WABA_WEBHOOK_CONFIG || '{}'
export const ARCHIVE_WEBHOOK_CONFIG = process.env.ARCHIVE_WEBHOOK_CONFIG || '{}'
export const ARCHIVE_MESSAGE_TEMPLATE =
  process.env.ARCHIVE_MESSAGE_TEMPLATE || ''
