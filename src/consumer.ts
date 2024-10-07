import { AckPolicy, connect } from 'nats'
import { NATS_SERVERS, NATS_TOKEN } from './config'

const nc = await connect({
  servers: NATS_SERVERS,
  token: NATS_TOKEN,
})
const js = nc.jetstream()
const jsm = await js.jetstreamManager()

await jsm.consumers.add('EVENTS', {
  durable_name: 'ncbaileys_processor',
  ack_policy: AckPolicy.Explicit,
  filter_subject: 'events.ncbaileys.>',
})

await nc.close()
