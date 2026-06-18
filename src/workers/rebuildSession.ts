import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'
import type { SerializedChannel } from './parseProtocol'

/** Rebuild a LogSession from the worker's transferred channels + meta. */
export function rebuildLogSession(
  channels: SerializedChannel[],
  meta: LogMeta,
): LogSession {
  const ch: Channel[] = channels.map((c) => ({
    name: c.name,
    rawName: c.rawName,
    description: c.description,
    data: c.data,
  }))
  return new LogSession(ch, meta)
}
