/**
 * Phase 5 — session merge, step 2: given a time offset from
 * {@link crossCorrelateOffset} (sessionAlign.ts), actually build the merged
 * channel set — base session's own channels untouched, plus the GPS
 * session's GPS channels resampled onto the base's time axis with the offset
 * applied.
 *
 * Kept separate from sessionAlign.ts: alignment (finding the offset) and
 * merging (applying it to produce channels) are independently useful and
 * independently testable — a caller might want to let the user nudge the
 * auto-detected offset before merging, without re-running correlation.
 */

import type { Channel } from '@/domain/model/types'

/** GPS-family channel names to pull from the GPS session (superset; only present ones are merged). */
export const GPS_CHANNEL_NAMES: readonly string[] = ['GPS_Lat', 'GPS_Lon', 'GPS_Speed', 'GPS_Course'] as const

/** Minimal shape this module needs from a LogSession — avoids a hard dependency on the class so callers can pass a LogSession directly (structural typing) or a lighter stand-in in tests. */
export interface ChannelSource {
  readonly channels: readonly Channel[]
  get(name: string): Channel | undefined
  readonly timeChannel: Channel | undefined
}

/** Linear-interpolate `data` (indexed by parallel `timeMs`) at time `t`. NaN if `t` is outside range or the bracketing samples are NaN. */
function sampleAt(timeMs: ArrayLike<number>, data: ArrayLike<number>, t: number): number {
  const n = timeMs.length
  if (n === 0) return NaN
  if (t < timeMs[0] || t > timeMs[n - 1]) return NaN

  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (timeMs[mid] < t) lo = mid + 1
    else hi = mid
  }
  const i1 = lo
  if (timeMs[i1] === t) return data[i1]
  if (i1 === 0) return NaN
  const i0 = i1 - 1
  const t0 = timeMs[i0]
  const t1 = timeMs[i1]
  const span = t1 - t0
  if (!(span > 0)) return data[i0]
  const frac = (t - t0) / span
  const v0 = data[i0]
  const v1 = data[i1]
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return NaN
  return v0 + frac * (v1 - v0)
}

export interface MergeSessionsOptions {
  /**
   * Milliseconds to ADD to the GPS session's time axis so it lines up with
   * the base session's time axis (same convention as
   * {@link crossCorrelateOffset}'s `offsetMs`).
   */
  offsetMs: number
  /** GPS channel names to pull from `gps`. Defaults to {@link GPS_CHANNEL_NAMES}. */
  gpsChannelNames?: readonly string[]
}

/**
 * Merge GPS channels from `gps` into `base`'s channel set, resampled onto
 * `base`'s own time axis.
 *
 * For each requested GPS channel name present in `gps`: at every sample of
 * `base`'s time axis, look up the corresponding instant in `gps`'s clock
 * (`baseTime - offsetMs`, inverse of the "add offsetMs to gps to match base"
 * convention) and linearly interpolate `gps`'s channel there. Samples
 * outside `gps`'s covered time range (after applying the offset) become NaN
 * — "no GPS data at this instant" — rather than extrapolated.
 *
 * `base`'s own channels are returned unchanged (same array references, not
 * copied) — this function only appends new channels, it never mutates or
 * resamples the base session's existing data.
 *
 * Returns null when `base` has no time axis or fewer than 1 sample, or
 * `gps` has no time axis (nothing to align against).
 */
export function mergeSessions(base: ChannelSource, gps: ChannelSource, opts: MergeSessionsOptions): Channel[] | null {
  const baseTime = base.timeChannel
  const gpsTime = gps.timeChannel
  if (!baseTime || baseTime.data.length === 0) return null
  if (!gpsTime || gpsTime.data.length === 0) return null

  const { offsetMs, gpsChannelNames = GPS_CHANNEL_NAMES } = opts
  const baseTimeData = baseTime.data
  const gpsTimeData = gpsTime.data
  const n = baseTimeData.length

  const merged: Channel[] = [...base.channels]
  const existingNames = new Set(base.channels.map((c) => c.name))

  for (const name of gpsChannelNames) {
    const source = gps.get(name)
    if (!source) continue

    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const gpsInstant = baseTimeData[i] - offsetMs
      out[i] = sampleAt(gpsTimeData, source.data, gpsInstant)
    }

    const channel: Channel = {
      name,
      rawName: source.rawName,
      description: source.description,
      unit: source.unit,
      data: out,
    }

    if (existingNames.has(name)) {
      // Base already has a channel with this name (e.g. a broken/partial GPS
      // channel) — replace it with the merged-in GPS data rather than
      // duplicating the name.
      const idx = merged.findIndex((c) => c.name === name)
      merged[idx] = channel
    } else {
      merged.push(channel)
    }
  }

  return merged
}
