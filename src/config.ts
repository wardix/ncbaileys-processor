export const NATS_SERVERS = process.env.NATS_SERVERS || 'nats://localhost:4222'
export const NATS_TOKEN = process.env.NATS_TOKEN || ''
export const MAX_BACKOFF_DELAY_SECONDS =
  process.env.MAX_BACKOFF_DELAY_SECONDS || 8
export const MIN_BACKOFF_DELAY_SECONDS =
  process.env.MIN_BACKOFF_DELAY_SECONDS || 1
export const WABA_TEXT_MESSAGE_TEMPLATE =
  process.env.WABA_TEXT_MESSAGE_TEMPLATE || ''
export const WABA_WEBHOOK_URL = process.env.WABA_WEBHOOK_URL || ''
export const WABA_WEBHOOK_SECRET = process.env.WABA_WEBHOOK_SECRET || ''
