import type { Channel, LogMeta } from './types'
import { aliasCandidates } from '@/domain/parsing/canonical'

/**
 * A parsed .loga log: a column-store of channels plus header metadata.
 * Channel lookup is alias-aware (see ALIASES) so callers can ask for the
 * logical signal name without knowing the firmware-specific column name.
 */
export class LogSession {
  private readonly byName: Map<string, Channel>

  constructor(
    readonly channels: readonly Channel[],
    readonly meta: LogMeta,
  ) {
    this.byName = new Map(channels.map((c) => [c.name, c]))
  }

  /** Number of sample rows. */
  get rowCount(): number {
    return this.channels.length > 0 ? this.channels[0].data.length : 0
  }

  /** Resolve a channel by canonical name or alias group. */
  get(name: string): Channel | undefined {
    for (const candidate of aliasCandidates(name)) {
      const channel = this.byName.get(candidate)
      if (channel) return channel
    }
    return undefined
  }

  has(name: string): boolean {
    return this.get(name) !== undefined
  }

  /** The time axis channel ('Time' or 'Timer'), if present. */
  get timeChannel(): Channel | undefined {
    return this.get('Time') ?? this.get('Timer')
  }

  /** Median sample interval in milliseconds, or null if not derivable. */
  get sampleIntervalMs(): number | null {
    const time = this.timeChannel
    if (!time || time.data.length < 2) return null

    const diffs: number[] = []
    const limit = Math.min(time.data.length, 1001)
    for (let i = 1; i < limit; i++) {
      const d = time.data[i] - time.data[i - 1]
      if (Number.isFinite(d) && d > 0) diffs.push(d)
    }
    if (diffs.length === 0) return null

    diffs.sort((a, b) => a - b)
    return diffs[Math.floor(diffs.length / 2)]
  }

  /** Estimated sample rate in Hz, or null if not derivable. */
  get sampleRateHz(): number | null {
    const interval = this.sampleIntervalMs
    return interval ? 1000 / interval : null
  }
}
