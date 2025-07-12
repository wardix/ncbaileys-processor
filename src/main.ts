import { connect, StringCodec } from 'nats'
import crypto from 'crypto'
import axios from 'axios'
import {
  ARCHIVE_MESSAGE_TEMPLATE,
  ARCHIVE_WEBHOOK_CONFIG,
  MAX_BACKOFF_DELAY_SECONDS,
  MIN_BACKOFF_DELAY_SECONDS,
  NATS_SERVERS,
  NATS_TOKEN,
  WABA_MESSAGE_TEMPLATE,
  WABA_WEBHOOK_CONFIG,
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
  const webhook = JSON.parse(WABA_WEBHOOK_CONFIG)

  try {
    while (true) {
      const messages = await c.fetch({ max_messages: 1, expires: 1000 })
      let hasMessages = false
      for await (const message of messages) {
        hasMessages = true
        const [_event, _keyword, account] = message.subject.split('.')
        const { url: webhookUrl, secret: webhookSecret } = webhook[account]
          ? webhook[account]
          : webhook?.default
            ? webhook.default
            : { url: null, secret: null }
        if (!webhookUrl) {
          continue
        }
        const data = JSON.parse(sc.decode(message.data))
        for (const waMessage of data.messages) {
          const isGroupConversation =
            !waMessage.key.remoteJid.endsWith('@s.whatsapp.net')
          console.log(JSON.stringify(waMessage, null, 2))
          if (waMessage.key.fromMe && waMessage.status === 'PENDING') {
            continue
          }
          if (waMessage.key.remoteJid == 'status@broadcast') {
            continue
          }
          if (!('message' in waMessage)) {
            continue
          }
          if (
            !('conversation' in waMessage.message) &&
            !('extendedTextMessage' in waMessage.message) &&
            !('locationMessage' in waMessage.message) &&
            !('imageMessage' in waMessage.message) &&
            !('videoMessage' in waMessage.message) &&
            !('documentWithCaptionMessage' in waMessage.message)
          ) {
            console.log('unknown message')
            continue
          }
          const waId = !isGroupConversation
            ? waMessage.key.remoteJid.replace('@s.whatsapp.net', '')
            : waMessage.key.remoteJid
          if (waMessage.key.fromMe) {
            const archiveWebhook = JSON.parse(ARCHIVE_WEBHOOK_CONFIG)
            const archiveMessage = JSON.parse(ARCHIVE_MESSAGE_TEMPLATE)
            if (!(account in archiveWebhook)) {
              continue
            }
            archiveMessage.id = waMessage.key.id
            archiveMessage.to = waId
            const { url, params, headers } = archiveWebhook[account]
            headers['Content-Type'] = 'application/json'

            if ('conversation' in waMessage.message) {
              archiveMessage.type = 'text'
              archiveMessage.text = {
                preview_url: false,
                body: waMessage.message.conversation,
              }
            } else if ('extendedTextMessage' in waMessage.message) {
              archiveMessage.type = 'text'
              archiveMessage.text = {
                preview_url: false,
                body: waMessage.message.extendedTextMessage.text,
              }
              if (
                'contextInfo' in waMessage.message.extendedTextMessage &&
                'stanzaId' in waMessage.message.extendedTextMessage.contextInfo
              ) {
                const { stanzaId, participant } =
                  waMessage.message.extendedTextMessage.contextInfo
                archiveMessage.context = {
                  from: participant.replace('@s.whatsapp.net', ''),
                  message_id: stanzaId,
                }
              }
            } else if ('locationMessage' in waMessage.message) {
              archiveMessage.type = 'location'
              archiveMessage.location = {
                latitude: waMessage.message.locationMessage.degreesLatitude,
                longitude: waMessage.message.locationMessage.degreesLongitude,
                name: waMessage.message.locationMessage.name,
                address: waMessage.message.locationMessage.address,
              }
              if (
                'contextInfo' in waMessage.message.locationMessage &&
                'stanzaId' in waMessage.message.locationMessage.contextInfo
              ) {
                const { stanzaId, participant } =
                  waMessage.message.locationMessage.contextInfo
                archiveMessage.context = {
                  from: participant.replace('@s.whatsapp.net'),
                  message_id: stanzaId,
                }
              }
            } else if ('imageMessage' in waMessage.message) {
              archiveMessage.type = 'image'
              archiveMessage.image = {
                mime_type: waMessage.message.imageMessage.mimetype,
                sha256: waMessage.message.imageMessage.fileSha256,
                id: waMessage.message.imageMessage.id,
              }
              if (waMessage.message.imageMessage.caption) {
                archiveMessage.image.caption =
                  waMessage.message.imageMessage.caption
              }
              if (
                'contextInfo' in waMessage.message.imageMessage &&
                'stanzaId' in waMessage.message.imageMessage.contextInfo
              ) {
                const { stanzaId, participant } =
                  waMessage.message.imageMessage.contextInfo
                archiveMessage.context = {
                  from: participant.replace('@s.whatsapp.net'),
                  message_id: stanzaId,
                }
              }
            } else if ('videoMessage' in waMessage.message) {
              archiveMessage.type = 'video'
              archiveMessage.video = {
                mime_type: waMessage.message.videoMessage.mimetype,
                sha256: waMessage.message.videoMessage.fileSha256,
                id: waMessage.message.videoMessage.id,
              }
              if (waMessage.message.videoMessage.caption) {
                archiveMessage.video.caption =
                  waMessage.message.videoMessage.caption
              }
              if (
                'contextInfo' in waMessage.message.videoMessage &&
                'stanzaId' in waMessage.message.videoMessage.contextInfo
              ) {
                const { stanzaId, participant } =
                  waMessage.message.videoMessage.contextInfo
                archiveMessage.context = {
                  from: participant.replace('@s.whatsapp.net'),
                  message_id: stanzaId,
                }
              }
            } else if ('documentWithCaptionMessage' in waMessage.message) {
              archiveMessage.type = 'document'
              archiveMessage.document = {
                mime_type:
                  waMessage.message.documentWithCaptionMessage.message
                    .documentMessage.mimetype,
                sha256:
                  waMessage.message.documentWithCaptionMessage.message
                    .documentMessage.fileSha256,
                id: waMessage.message.documentWithCaptionMessage.message
                  .documentMessage.id,
                filename:
                  waMessage.message.documentWithCaptionMessage.message
                    .documentMessage.fileName,
              }
              if (
                waMessage.message.documentWithCaptionMessage.message
                  .documentMessage.caption
              ) {
                archiveMessage.document.caption =
                  waMessage.message.documentWithCaptionMessage.message.documentMessage.caption
              }
              if (
                'contextInfo' in waMessage.message.documentWithCaptionMessage &&
                'stanzaId' in
                  waMessage.message.documentWithCaptionMessage.contextInfo
              ) {
                const { stanzaId, participant } =
                  waMessage.message.documentWithCaptionMessage.contextInfo
                archiveMessage.context = {
                  from: participant.replace('@s.whatsapp.net'),
                  message_id: stanzaId,
                }
              }
            }
            await axios.post(url, archiveMessage, { params, headers })
            continue
          }
          const wabaMessage = JSON.parse(WABA_MESSAGE_TEMPLATE)
          wabaMessage.entry[0].id = account
          wabaMessage.entry[0].changes[0].value.metadata.display_phone_number =
            account
          wabaMessage.entry[0].changes[0].value.metadata.phone_number_id =
            account
          if (isGroupConversation) {
            wabaMessage.entry[0].changes[0].value.contacts[0].profile.name =
              waMessage.key.subject
            wabaMessage.entry[0].changes[0].value.contacts[0]['participant'] = {
              name: waMessage.pushName,
              wa_id: waMessage.key.participant
                ? waMessage.key.participant.replace('@s.whatsapp.net', '')
                : waMessage.participant.replace('@s.whatsapp.net', ''),
            }
          } else {
            wabaMessage.entry[0].changes[0].value.contacts[0].profile.name =
              waMessage.pushName
          }
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
          } else if ('extendedTextMessage' in waMessage.message) {
            wabaMessage.entry[0].changes[0].value.messages[0].type = 'text'
            wabaMessage.entry[0].changes[0].value.messages[0].text = {
              body: waMessage.message.extendedTextMessage.text,
            }
            if (
              'contextInfo' in waMessage.message.extendedTextMessage &&
              'stanzaId' in waMessage.message.extendedTextMessage.contextInfo
            ) {
              const { stanzaId, participant } =
                waMessage.message.extendedTextMessage.contextInfo
              wabaMessage.entry[0].changes[0].value.messages[0].context = {
                from: participant.replace('@s.whatsapp.net'),
                id: stanzaId,
              }
            }
          } else if ('locationMessage' in waMessage.message) {
            wabaMessage.entry[0].changes[0].value.messages[0].type = 'location'
            wabaMessage.entry[0].changes[0].value.messages[0].location = {
              latitude: waMessage.message.locationMessage.degreesLatitude,
              longitude: waMessage.message.locationMessage.degreesLongitude,
              name: waMessage.message.locationMessage.name,
              address: waMessage.message.locationMessage.address,
            }
            if (
              'contextInfo' in waMessage.message.locationMessage &&
              'stanzaId' in waMessage.message.locationMessage.contextInfo
            ) {
              const { stanzaId, participant } =
                waMessage.message.locationMessage.contextInfo
              wabaMessage.entry[0].changes[0].value.messages[0].context = {
                from: participant.replace('@s.whatsapp.net'),
                id: stanzaId,
              }
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
            if (
              'contextInfo' in waMessage.message.imageMessage &&
              'stanzaId' in waMessage.message.imageMessage.contextInfo
            ) {
              const { stanzaId, participant } =
                waMessage.message.imageMessage.contextInfo
              wabaMessage.entry[0].changes[0].value.messages[0].context = {
                from: participant.replace('@s.whatsapp.net'),
                id: stanzaId,
              }
            }
          } else if ('videoMessage' in waMessage.message) {
            wabaMessage.entry[0].changes[0].value.messages[0].type = 'video'
            wabaMessage.entry[0].changes[0].value.messages[0].video = {
              mime_type: waMessage.message.videoMessage.mimetype,
              sha256: waMessage.message.videoMessage.fileSha256,
              id: waMessage.message.videoMessage.id,
            }
            if (waMessage.message.videoMessage.caption) {
              wabaMessage.entry[0].changes[0].value.messages[0].video.caption =
                waMessage.message.videoMessage.caption
            }
            if (
              'contextInfo' in waMessage.message.videoMessage &&
              'stanzaId' in waMessage.message.videoMessage.contextInfo
            ) {
              const { stanzaId, participant } =
                waMessage.message.videoMessage.contextInfo
              wabaMessage.entry[0].changes[0].value.messages[0].context = {
                from: participant.replace('@s.whatsapp.net'),
                id: stanzaId,
              }
            }
          } else if ('documentWithCaptionMessage' in waMessage.message) {
            wabaMessage.entry[0].changes[0].value.messages[0].type = 'document'
            wabaMessage.entry[0].changes[0].value.messages[0].document = {
              mime_type:
                waMessage.message.documentWithCaptionMessage.message
                  .documentMessage.mimetype,
              sha256:
                waMessage.message.documentWithCaptionMessage.message
                  .documentMessage.fileSha256,
              id: waMessage.message.documentWithCaptionMessage.message
                .documentMessage.id,
              filename:
                waMessage.message.documentWithCaptionMessage.message
                  .documentMessage.fileName,
            }
            if (
              waMessage.message.documentWithCaptionMessage.message
                .documentMessage.caption
            ) {
              wabaMessage.entry[0].changes[0].value.messages[0].document.caption =
                waMessage.message.documentWithCaptionMessage.message.documentMessage.caption
            }
            if (
              'contextInfo' in waMessage.message.documentWithCaptionMessage &&
              'stanzaId' in
                waMessage.message.documentWithCaptionMessage.contextInfo
            ) {
              const { stanzaId, participant } =
                waMessage.message.documentWithCaptionMessage.contextInfo
              wabaMessage.entry[0].changes[0].value.messages[0].context = {
                from: participant.replace('@s.whatsapp.net'),
                id: stanzaId,
              }
            }
          }
          const postData = JSON.stringify(wabaMessage)
          const sha1Signature = crypto
            .createHmac('sha1', webhookSecret)
            .update(postData)
            .digest('hex')
          const signature = `sha1=${sha1Signature}`

          console.log(signature)
          console.log(postData)
          try {
            const response = await axios.post(webhookUrl, postData, {
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
