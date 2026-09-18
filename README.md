# ncbaileys-processor

Message processor service yang mengkonsumsi pesan WhatsApp dari NATS JetStream dan meneruskannya ke webhook tujuan dengan format terstruktur.

## Overview

Service ini menjembatani pesan WhatsApp dari Bailey's library ke dua destination webhook:

1. **WABA Webhook** — Pesan masuk dikonversi ke format WhatsApp Business API
2. **Archive Webhook** — Pesan keluar (fromMe) disimpan ke sistem archive

Dirancang untuk menangani volume tinggi dengan retry otomatis, backoff eksponensial, dan deteksi cerdas untuk pesan grup vs. direct.

## Integration dengan ncbaileys

ncbaileyproc adalah downstream consumer dari [ncbaileys](https://github.com/nusanet/ncbaileys) library. Berikut adalah data flow lengkapnya:

```
WhatsApp Client
       ↓
   ncbaileys (Bailey's library)
       ↓ (publish events)
NATS JetStream
  Stream: EVENTS
  Topic: events.ncbaileys.{session}.messages_received
       ↓ (subscribe & consume)
ncbaileyproc (processor ini)
       ├→ Process & validate
       └→ Forward ke webhooks
         • WABA Webhook (incoming messages)
         • Archive Webhook (outgoing messages)
```

**Bagaimana cara kerjanya**:
1. ncbaileys menangkap pesan WhatsApp (incoming/outgoing) dan mempublikasikannya ke NATS JetStream
2. ncbaileyproc memiliki durable consumer `ncbaileys_processor` yang subscribe ke topic `events.ncbaileys.>`
3. Pesan di-consume satu per satu, divalidasi, dan dikonversi ke format WABA atau Archive
4. Setiap pesan yang berhasil diproses di-forward ke destination webhook (berdasarkan konfigurasi account)

**Payload Message**:
Detail lengkap tentang struktur message payload yang dipublikasikan ncbaileys tersedia di [ncbaileys README — section "Event Stream (NATS)"](../ncbaileys/README.md#event-stream-nats).

## Fitur

- ✅ Konsumsi pesan dari NATS JetStream dengan durable consumer
- ✅ Konversi otomatis ke format WABA atau Archive
- ✅ Dukungan berbagai tipe pesan: teks, lokasi, kontak (vCard), media (gambar, video, dokumen)
- ✅ Deteksi grup vs. percakapan direct
- ✅ Signature HMAC-SHA1 untuk keamanan webhook
- ✅ Retry otomatis dengan exponential backoff untuk rate limiting (429)
- ✅ Backoff consumer saat tidak ada pesan (1–8 detik, dapat dikonfigurasi)
- ✅ Filter pesan: abaikan self-messages, broadcasts, pesan cacat

## Instalasi

### Prerequisites

- [Bun](https://bun.sh) (runtime)
- NATS JetStream server (untuk message broker)
- TypeScript 5.0+

### Setup

```bash
# Clone repository
git clone <repo-url>
cd ncbaileys-processor

# Install dependencies
bun install

# Setup environment
cp .env.dist .env
# Edit .env dengan konfigurasi NATS dan webhook URL
```

### Konfigurasi NATS Consumer (One-time)

```bash
bun run src/consumer.ts
```

Membuat durable consumer `ncbaileys_processor` di stream `EVENTS` dengan filter `events.ncbaileys.>`.

## Konfigurasi

Edit `.env` atau set environment variables:

### NATS Connection

```bash
NATS_SERVERS=nats://localhost:4222
NATS_TOKEN=your-auth-token
```

### Webhook Routing

#### WABA Webhook (Pesan Masuk)

```bash
WABA_WEBHOOK_CONFIG='
{
  "62812345678": {
    "url": "https://api.example.com/webhook",
    "secret": "webhook-signing-secret"
  },
  "default": {
    "url": "https://api.example.com/webhook",
    "secret": "default-secret"
  }
}'
```

Setiap nomor akun dapat memiliki webhook terpisah. Jika akun tidak tercantum, akan menggunakan config `default`.

#### Archive Webhook (Pesan Keluar)

```bash
ARCHIVE_WEBHOOK_CONFIG='
{
  "62812345678": {
    "url": "https://archive.example.com/messages/out",
    "params": {},
    "headers": {}
  }
}'
```

Hanya pesan keluar (fromMe) yang dikirim ke archive webhook.

### Message Templates

```bash
# Template JSON untuk WABA webhook
WABA_MESSAGE_TEMPLATE='{"entry":[{"id":"","changes":[{"value":{"metadata":{"display_phone_number":"","phone_number_id":""},"messages":[],"contacts":[]}}]}]}'

# Template JSON untuk Archive webhook
ARCHIVE_MESSAGE_TEMPLATE='{"id":"","type":"","to":"","text":{},"location":{},"contacts":[],"image":{},"video":{},"document":{}}'
```

### Tuning

```bash
MIN_BACKOFF_DELAY_SECONDS=1       # Backoff minimal (detik)
MAX_BACKOFF_DELAY_SECONDS=8       # Backoff maksimal (detik)
```

Backoff digunakan ketika tidak ada pesan. Setiap iterasi tanpa pesan, delay digandakan hingga mencapai MAX.

## Penggunaan

### Development (Hot Reload)

```bash
bun run dev
```

Server akan restart otomatis saat file TypeScript berubah.

### Production Build

```bash
bun run build
```

Menghasilkan `dist/main.js` (minified, optimized untuk Bun runtime).

### Jalankan Production Build

```bash
bun dist/main.js
```

## Message Flow

```
ncbaileys publishes ke NATS topic: events.ncbaileys.{session}.messages_received
                ↓
ncbaileyproc consumer (durable: ncbaileys_processor, filter: events.ncbaileys.>)
                ↓
1. Fetch 1 pesan dari NATS (timeout 1000ms)
   ↓
2. Filter → Skip if:
   • fromMe + PENDING status (belum terkirim)
   • status@broadcast (status updates)
   • Malformed (missing 'message' field atau null)
   ↓
3. Parse → Ekstrak tipe pesan (text, location, contact, media)
   ↓
4. Detect Group → Cek remoteJid ends with @g.us
   ↓
5. Convert → Transform ke format WABA atau Archive
   ↓
6. Route:
   • Outgoing (fromMe) → ARCHIVE_WEBHOOK (jika configured)
   • Incoming → WABA_WEBHOOK (semua incoming)
   ↓
7. Send → POST ke webhook dengan signature (WABA only)
        Retry dengan exponential backoff if HTTP 429
   ↓
8. Ack → Acknowledge message ke NATS JetStream
```

**Catatan**: Message payload yang diterima dari NATS berasal dari ncbaileys format. Struktur lengkapnya dijelaskan di ncbaileys README section "Event Stream (NATS)".

## Tipe Pesan yang Didukung

| Tipe | Field | Deskripsi |
|------|-------|-----------|
| Text | conversation, extendedTextMessage | Teks biasa atau teks dengan konteks |
| Location | locationMessage | Latitude, longitude, nama, alamat |
| Contact | contactMessage | vCard dengan FN (nama) + TEL (nomor) + WAID |
| Image | imageMessage | MIME type, SHA256, caption (opsional) |
| Video | videoMessage | MIME type, SHA256, caption (opsional) |
| Document | documentWithCaptionMessage | MIME type, SHA256, filename, caption |

## Security

### Signature WABA

Setiap webhook WABA ditandai dengan HMAC-SHA1:

```
X-Hub-Signature: sha1=<hex(HMAC-SHA1(body, secret))>
```

Validasi di server penerima dengan `secret` dari WABA_WEBHOOK_CONFIG.

### Archive Webhook

Archive webhook tidak ditandai (configurabel di ARCHIVE_WEBHOOK_CONFIG headers).

## Logging

Semua pesan dan HTTP responses di-log ke stdout:

```bash
# Pesan detail (JSON prettified)
console.log(JSON.stringify(waMessage, null, 2))

# Signature (untuk debug)
console.log(signature)

# Response dari webhook
console.log(response.data)

# Error
console.error('Error', error)
```

Untuk production, redirect stdout ke log aggregation system (Cloudwatch, ELK, dll).

## Troubleshooting

### Webhook tidak menerima pesan

1. Cek `WABA_WEBHOOK_CONFIG` dan `ARCHIVE_WEBHOOK_CONFIG` di `.env`
2. Pastikan URL webhook accessible dan HTTPS valid
3. Periksa logs untuk HTTP errors atau signature mismatches
4. Jika akun tidak di-map, service akan menggunakan `default` config

### NATS Consumer tidak terbuat

```bash
# Debugging: check NATS connection
bun run src/consumer.ts
```

Jika error, cek:
- NATS_SERVERS URL benar
- NATS_TOKEN valid
- Stream `EVENTS` ada di NATS server

### Pesan hilang atau duplikat

- Consumer adalah durable (state persisten)
- Jika service crash sebelum ACK, pesan akan di-fetch lagi
- Webhook destination harus idempotent (handle duplikat gracefully)

## Architecture

```
src/
├── main.ts       # Main message loop & webhook routing
├── consumer.ts   # One-time NATS consumer setup
└── config.ts     # Environment variable loading
```

**main.ts** (527 lines):
- Koneksi NATS JetStream
- Consumer loop dengan exponential backoff
- Message type handlers (text, location, contact, media)
- HTTP retry logic dengan 429 handling
- Webhook posting (WABA + Archive)

**consumer.ts** (18 lines):
- Create durable consumer di stream EVENTS
- Filter subject: `events.ncbaileys.>`
- Ack policy: Explicit (manual per message)

**config.ts** (12 lines):
- Load environment variables
- Defaults untuk local development

## Development

Lihat [CLAUDE.md](./CLAUDE.md) untuk detail architecture dan common tasks.

## License

Private — PT Nusa Indonesia

---

**Questions?** Contact: david@nusa.id
