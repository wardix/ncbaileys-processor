# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Commands

```bash
# Development: run with hot reload
bun run dev

# Build: minified JS for production
bun run build

# One-time setup: create NATS consumer (durable subscription)
bun run src/consumer.ts
```

## Architecture Overview

**ncbaileys-processor** is a NATS JetStream message processor that bridges WhatsApp messages from Bailey's library to two webhook destinations:

```
NATS JetStream (EVENTS stream)
       ↓
  Message Consumer (ncbaileys_processor durable)
       ↓
  Main Processor (src/main.ts)
       ├─→ Incoming Messages → WABA Webhook (WhatsApp Business API format)
       └─→ Outgoing Messages (fromMe) → Archive Webhook
```

### Core Files

- **src/main.ts** — Primary message consumption loop, message type handling, webhook routing
  - Connects to NATS JetStream and fetches one message at a time
  - Converts Bailey's message format to WABA or Archive format based on message direction
  - Implements exponential backoff when message queue is empty
  - Handles HTTP request retries with exponential backoff (429 status code handling)

- **src/consumer.ts** — One-time setup to create NATS consumer (subscribe to events.ncbaileys.>)

- **src/config.ts** — Environment variable loading (NATS URLs, webhook templates, auth tokens)

## Message Flow

1. **Fetch** one message at a time from NATS (expires after 1000ms)
2. **Filter** messages (skip fromMe + PENDING, status broadcasts, malformed data)
3. **Parse** message type (text, location, contact with vCard, images/videos/documents)
4. **Detect** conversation type (group @g.us or direct @s.whatsapp.net)
5. **Route**:
   - **Outgoing (fromMe)**: Convert to archive format, POST to ARCHIVE_WEBHOOK_CONFIG[account]
   - **Incoming**: Convert to WABA format, sign with HMAC-SHA1, POST to WABA_WEBHOOK_CONFIG[account]
6. **Retry** on HTTP 429 (rate limit) with exponential backoff
7. **Ack** message on successful delivery

## Configuration (Environment Variables)

Webhook routing uses account-based config maps:

```bash
# WABA webhook mapping: { "account": { "url": "...", "secret": "..." }, "default": {...} }
WABA_WEBHOOK_CONFIG='{"62812345678":{"url":"https://api.example.com/webhook","secret":"key"}}'

# Archive webhook mapping: { "account": { "url": "...", "params": {...}, "headers": {...} } }
ARCHIVE_WEBHOOK_CONFIG='{"62812345678":{"url":"https://archive.example.com/out","params":{},"headers":{}}}'

# Message templates (JSON strings with variable substitution)
WABA_MESSAGE_TEMPLATE='{"entry":[{"changes":[{"value":{"messages":[],"contacts":[]}}]}]}'
ARCHIVE_MESSAGE_TEMPLATE='{"id":"","type":"","to":""}'

# NATS connection
NATS_SERVERS=nats://localhost:4222
NATS_TOKEN=your-token

# Backoff timing (seconds)
MIN_BACKOFF_DELAY_SECONDS=1
MAX_BACKOFF_DELAY_SECONDS=8
```

The `default` key in WABA_WEBHOOK_CONFIG is used if the account isn't explicitly mapped.

## Key Implementation Details

### Message Type Support
- Text (conversation, extendedTextMessage)
- Location (with name, address, coordinates)
- Contacts (vCard parsed, TEL + FN fields extracted)
- Media (image, video, documentWithCaption)

### Group Detection
Groups end with `@g.us`. Direct messages end with `@s.whatsapp.net`. Parser handles `remoteJidAlt` fallback for ID extraction.

### vCard Parsing
Contact messages contain vCard format. Parser (vcard4-ts) extracts:
- Name (FN field → formatted_name, N field → first_name)
- Phones (TEL array, WAID custom parameter)

### Signature Generation (WABA only)
HMAC-SHA1 signature over entire POST body: `sha1=hex(HMAC_SHA1(body, secret))`
Header: `X-Hub-Signature`

### Retry Strategy
- **postWithRetry()** uses exponential backoff: base 512ms, doubles per retry, max 16 attempts
- Only retries on 429 (too many requests). Other HTTP errors throw immediately.
- Consumer backoff (no messages) separate: 1–8s exponential, resets on message arrival

## Common Tasks

**Adding a new message type**:
1. Add type check in the message filter condition (~line 69)
2. Add extraction logic for both WABA (~line 292) and Archive (~line 97) paths
3. Update WABA_MESSAGE_TEMPLATE if new fields needed

**Debugging message flow**: 
Console logs message body (line 65) and signature (line 470). Check `.env` webhook URLs and secrets; null webhook URL silently skips processing.

**Testing webhook delivery**:
Export templates and config, run locally against NATS dev server and test webhook endpoint.

## Dependencies

- **nats** v2.28.2 — NATS JetStream client
- **axios** v1.7.7 — HTTP client with retry wrapper
- **vcard4-ts** v0.4.1 — vCard format parser
- **crypto** (Node.js built-in) — HMAC-SHA1 signatures
