import type { LogSession } from '@/domain/model/LogSession'
import { timeSeconds } from '@/domain/analysis/timeAxis'
import {
  inferChannelUpdateRateHz,
  summarizeChannelUpdateRates,
  type ChannelUpdateRateSummary,
} from '@/domain/analysis/channelUpdateRate'

export interface SessionChannelUpdateRates extends ChannelUpdateRateSummary {
  readonly byChannel: ReadonlyMap<string, number | null>
}

interface SessionCacheEntry {
  elapsedSeconds: Float64Array
  byChannel: Map<string, number | null>
  summary: SessionChannelUpdateRates | null
}

// A parsed LogSession is the in-memory identity of one imported file. Weak
// keys release the cached scans when that file/session is no longer retained.
const sessionCache = new WeakMap<LogSession, SessionCacheEntry>()

function entryFor(session: LogSession): SessionCacheEntry {
  let entry = sessionCache.get(session)
  if (!entry) {
    entry = { elapsedSeconds: timeSeconds(session), byChannel: new Map(), summary: null }
    sessionCache.set(session, entry)
  }
  return entry
}

/** Return a file+channel rate, scanning that channel at most once per session. */
export function cachedChannelUpdateRateHz(
  session: LogSession,
  channelName: string,
  data?: ArrayLike<number>,
): number | null {
  const entry = entryFor(session)
  if (entry.byChannel.has(channelName)) return entry.byChannel.get(channelName) ?? null
  const values = data ?? session.channels.find((channel) => channel.name === channelName)?.data
  const rate = values ? inferChannelUpdateRateHz(values, entry.elapsedSeconds) : null
  entry.byChannel.set(channelName, rate)
  return rate
}

/** Return all raw-channel rates and their GPS/ECU representatives for one file. */
export function cachedSessionChannelUpdateRates(session: LogSession): SessionChannelUpdateRates {
  const entry = entryFor(session)
  if (entry.summary) return entry.summary
  const rates = session.channels.map((channel) => ({
    name: channel.name,
    rateHz: cachedChannelUpdateRateHz(session, channel.name, channel.data),
  }))
  const summary = summarizeChannelUpdateRates(rates)
  entry.summary = { byChannel: entry.byChannel, ...summary }
  return entry.summary
}
