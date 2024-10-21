import { connect, StringCodec } from 'nats'
import crypto from 'crypto'
import axios from 'axios'
import {
  MAX_BACKOFF_DELAY_SECONDS,
  MIN_BACKOFF_DELAY_SECONDS,
  NATS_SERVERS,
  NATS_TOKEN,
  WABA_MESSAGE_TEMPLATE,
  WABA_WEBHOOK_SECRET,
  WABA_WEBHOOK_URL,
} from './config'

const sc = StringCodec()

async function consumeMessages() {
  let backoffDelay = Number(MIN_BACKOFF_DELAY_SECONDS) * 1000

  process.on('SIGINT', async () => {
    await nc.drain()
    process.exit()
  })

  const nc = await connect({
    servers: NATS_SERVERS,
    token: NATS_TOKEN,
  })

  const js = nc.jetstream()
  const c = await js.consumers.get('EVENTS', 'ncbaileys_processor')

  try {
    while (true) {
      const messages = await c.fetch({ max_messages: 1, expires: 1000 })
      let hasMessages = false
      for await (const message of messages) {
        hasMessages = true
        const data = JSON.parse(sc.decode(message.data))
        for (const waMessage of data.messages) {
          console.log(JSON.stringify(waMessage, null, 2))
          if (waMessage.key.fromMe) {
            continue
          }
          if (!waMessage.key.remoteJid.endsWith('@s.whatsapp.net')) {
            continue
          }
          if (
            !('conversation' in waMessage.message) &&
            !('imageMessage' in waMessage.message)
          ) {
	    console.log('not text message or image message')
            continue
          }
          const waId = waMessage.key.remoteJid.replace('@s.whatsapp.net', '')
          const wabaMessage = JSON.parse(WABA_MESSAGE_TEMPLATE)
          wabaMessage.entry[0].changes[0].value.contacts[0].profile.name =
            waMessage.pushName
          wabaMessage.entry[0].changes[0].value.contacts[0].wa_id = waId
          wabaMessage.entry[0].changes[0].value.messages[0].from = waId
          wabaMessage.entry[0].changes[0].value.messages[0].id =
            waMessage.key.id
          wabaMessage.entry[0].changes[0].value.messages[0].timestamp = `${waMessage.messageTimestamp}`
          if ('conversation' in waMessage.message) {
            wabaMessage.entry[0].changes[0].value.messages[0].type = 'text'
            wabaMessage.entry[0].changes[0].value.messages[0].text = {
              body: waMessage.message.conversation,
            }
          } else if ('imageMessage' in waMessage.message) {
            wabaMessage.entry[0].changes[0].value.messages[0].type = 'image'
            wabaMessage.entry[0].changes[0].value.messages[0].image = {
              mime_type: waMessage.message.imageMessage.mimetype,
              sha256: waMessage.message.imageMessage.fileSha256,
              id: waMessage.message.imageMessage.id,
            }
            if (waMessage.message.imageMessage.caption) {
              wabaMessage.entry[0].changes[0].value.messages[0].image.caption =
                waMessage.message.imageMessage.caption
            }
          }
          const postData = JSON.stringify(wabaMessage)
          const sha1Signature = crypto
            .createHmac('sha1', WABA_WEBHOOK_SECRET)
            .update(postData)
            .digest('hex')
          const signature = `sha1=${sha1Signature}`

          console.log(signature)
          console.log(postData)
          try {
            const response = await axios.post(WABA_WEBHOOK_URL, postData, {
              headers: {
                'Content-Type': 'application/json',
                'X-Hub-Signature': signature,
              },
            })
            console.log(response.data)
          } catch (error) {
            console.error('Error', error)
          }
        }

        message.ack()
        backoffDelay = 1000
      }
      if (!hasMessages) {
        await new Promise((resolve) => setTimeout(resolve, backoffDelay))
        backoffDelay = Math.min(
          backoffDelay * 2,
          Number(MAX_BACKOFF_DELAY_SECONDS) * 1000,
        )
        continue
      }
    }
  } catch (err) {
    console.error('Error during message consumtion: ', err)
  }
}

consumeMessages().catch((err) => {
  console.error('Error consuming message:', err)
})
