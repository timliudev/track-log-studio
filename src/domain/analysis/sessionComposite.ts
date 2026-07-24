/**
 * F4 phase 2 — composite segments: combine MULTIPLE sessions parsed from the
 * same multi-session `.rcnx` archive into one continuous {@link LogSession},
 * for a track day logged as separate morning/afternoon/etc. sessions the user
 * wants analysed (laps, sector timing, comparisons) as a single record.
 *
 * Deliberately NOT built on {@link mergeSessions} (sessionMerge.ts) — that
 * function solves a different problem (resample a SECOND session's channels
 * onto a FIRST session's existing time axis, e.g. splicing GPS into a loga
 * with broken GPS at the same point in time). Composite segments instead
 * CONCATENATE distinct time spans end-to-end: each segment keeps its own rows
 * untouched, only the time axis (and monotonic counter channels — see below)
 * are shifted so the whole thing reads as one continuous recording. No
 * resampling/interpolation is needed or wanted here; reusing `mergeSessions`
 * would force an artificial common time grid and either duplicate or discard
 * genuine samples. What IS reused: the same "register the produced LogSession
 * back into fileStore" path as SessionMerge (`fileStore.addMergedSession`,
 * wired in FileBar.vue), and the same `base.meta`-carries-forward convention
 * for the resulting session's metadata.
 *
 * ## Time axis — real elapsed gaps preserved, not naive concatenation
 *
 * Each segment's own `Time` channel starts at 0 (see parseRcnx.ts) and its
 * real wall-clock start is `session.meta.createdDate` (parseRcnx sets this
 * from `summary_N.txt`'s `startTime`, falling back to the first WayPoint's
 * timestamp). The composite's `Time` axis places every segment on ONE
 * absolute wall-clock timeline anchored at the FIRST segment's start (so the
 * first segment's own Time values are unchanged), i.e. for segment i, row j:
 *
 *   compositeTime[i][j] = (wallClockStart[i] + rawTime[i][j] - rawTime[i][0])
 *                         - wallClockStart[0]
 *
 * This is exactly "add a per-segment offset to that segment's own Time axis"
 * — the same offsetMs convention sessionMerge.ts/sessionAlign.ts use — so a
 * two-hour lunch break between a morning and afternoon session shows up as a
 * genuine two-hour gap in the composite Time axis (not zero, not clamped),
 * and overlapping/out-of-order wall-clock starts (a mis-set logger clock) are
 * trusted as given rather than reordered or corrected. If a segment's
 * `meta.createdDate` is missing (should not happen for `.rcnx`, but this
 * module accepts any `LogSession`), it falls back to appending that segment
 * immediately after the previous one ends (zero gap) — documented, not
 * silently wrong, and covered by a test.
 *
 * ## Mismatched channel sets — union + NaN-pad (not intersect)
 *
 * Every segment's parseRcnx output has the same fixed channel set EXCEPT
 * `IR_LapNumber`, which is only present when a segment's `sana_N.db` had lap
 * data (see parseRcnx.ts's `buildLapNumberChannel`). The composite channel
 * set is the UNION of every segment's channels; a segment missing a given
 * channel gets that channel's span filled with NaN — consistent with this
 * project's existing "NaN = no value here" convention (types.ts's Channel
 * doc, and sessionMerge.ts's own out-of-coverage NaN fill) — rather than
 * intersecting down to only the channels every segment shares, which would
 * silently drop a segment's lap data (or any other channel) just because
 * ONE other segment in the composite happened to lack it.
 *
 * ## Lap-counter seam — monotonic across segments, not naively concatenated
 *
 * `IR_LapNumber` is a counter that `detectLapsByChannel` (laps.ts) turns into
 * laps by finding each RISE above the previously-seen value; N laps need N+1
 * rises to be recovered (see parseRcnx.ts's own doc + B104, the precedent for
 * how easily this silently drops a lap). If segment B's counter were simply
 * concatenated as-is after segment A, it would restart near 0/1 — LOWER than
 * segment A's last (out-lap) value — and `detectLapsByChannel`'s "only count a
 * RISE" rule would swallow every one of segment B's early laps until its raw
 * counter climbs back past segment A's final value. Instead, `IR_LapNumber`
 * (and any other name listed in `monotonicCounterChannels`) is offset by a
 * RUNNING TOTAL carried across segments: segment i's raw counter values get
 * `+= runningOffset`, and afterwards `runningOffset += max(segment i's raw
 * counter)` before moving to segment i+1. A segment with no `IR_LapNumber` at
 * all contributes NaN for its span and leaves `runningOffset` unchanged (nothing
 * to carry forward), so a LATER segment's laps still continue counting up from
 * wherever the last segment that HAD lap data left off.
 *
 * One harmless side effect of this scheme, by construction rather than by
 * accident: `detectLapsByChannel` pairs every two CONSECUTIVE boundaries into
 * a lap, with no concept of "segment" at all. Segment i's own final boundary
 * (its trailing out-lap bump — see parseRcnx.ts's buildLapNumberChannel doc,
 * which exists ONLY to close that segment's own last lap when parsed in
 * isolation) ends up paired with segment i+1's own FIRST boundary (its first
 * real lap start) into one extra "connector" interval spanning the entire
 * gap between the two segments — e.g. for 2 real laps in segment A (3
 * boundaries) + 1 real lap in segment B (2 boundaries) = 5 boundaries total,
 * `detectLapsByChannel` returns 4 laps: A's 2 real laps, a connector, then B's
 * 1 real lap. This is NOT a lost lap (every real per-segment lap is present,
 * with its own correct duration, exactly the guarantee this module makes) —
 * it is an extra, trivially-identifiable entry (its index range straddles a
 * `segmentRowCounts` boundary and its duration is implausibly large, being the
 * real wall-clock gap between segments) that a caller wanting to hide it can
 * filter using `segmentRowCounts`. There is no way to suppress it by
 * rewriting the channel data instead: reverting segment i's tail bump so its
 * value stays flat into segment i+1 would eliminate that boundary entirely,
 * but that boundary is ALSO segment i's own last real lap's closing edge —
 * removing it would merge segment i's last lap together with the connector
 * AND segment i+1's first lap into one wrong span, actually losing a lap
 * rather than merely growing an extra harmless one.
 */
import type { Channel } from '@/domain/model/types'

/** Structural re-export so callers/tests can pass either a real LogSession or
 *  a lighter stand-in — same shape as sessionMerge.ts's ChannelSource, plus
 *  the metadata this module additionally needs (wall-clock start). */
export interface CompositeSegmentSource {
  readonly channels: readonly Channel[]
  get(name: string): Channel | undefined
  readonly timeChannel: Channel | undefined
  readonly meta: { readonly createdDate: Date | null }
}

/** Channel names treated as a monotonically-increasing counter across the
 *  seam (offset by a running total) rather than raw concatenation. */
export const DEFAULT_MONOTONIC_COUNTER_CHANNELS: readonly string[] = ['IR_LapNumber'] as const

export interface BuildCompositeSessionOptions {
  /** See {@link DEFAULT_MONOTONIC_COUNTER_CHANNELS}. */
  monotonicCounterChannels?: readonly string[]
}

export interface CompositeSessionResult {
  /** The composite channel set — 'Time' first, then every other channel name
   *  in first-appearance order across the segments. */
  channels: Channel[]
  /** Per-segment row count, in input order — for diagnostics/tests. */
  segmentRowCounts: number[]
  /** Per-segment ms ADDED to that segment's own Time values to place it on
   *  the composite timeline (see module doc), in input order. */
  segmentOffsetsMs: number[]
}

/**
 * Concatenate `segments` (already-parsed sessions from the same multi-session
 * archive, in the order they should play back) into one composite channel
 * set. See the module doc above for the time-axis, channel-union, and
 * lap-counter-seam rules.
 *
 * Returns null if `segments` is empty, or any segment has no time channel or
 * zero rows (nothing to place on a timeline).
 */
export function buildCompositeSession(
  segments: readonly CompositeSegmentSource[],
  opts: BuildCompositeSessionOptions = {},
): CompositeSessionResult | null {
  if (segments.length === 0) return null

  const monotonicNames = new Set(opts.monotonicCounterChannels ?? DEFAULT_MONOTONIC_COUNTER_CHANNELS)

  const segTimeData: Float32Array[] = []
  for (const seg of segments) {
    const time = seg.timeChannel
    if (!time || time.data.length === 0) return null
    segTimeData.push(time.data as Float32Array)
  }

  const segmentRowCounts = segTimeData.map((d) => d.length)
  const totalRows = segmentRowCounts.reduce((a, b) => a + b, 0)

  // --- per-segment offset (ms to add to that segment's OWN Time values) ---
  const segmentOffsetsMs: number[] = []
  const firstWallMs = segments[0].meta.createdDate?.getTime()
  let runningEndWallMs = (firstWallMs ?? 0) + segTimeData[0][0]
  for (let i = 0; i < segments.length; i++) {
    const rawTime0 = segTimeData[i][0]
    const wallMs = segments[i].meta.createdDate?.getTime()
    let segmentStartWallMs: number
    if (wallMs !== undefined && firstWallMs !== undefined) {
      segmentStartWallMs = wallMs
    } else {
      // Missing wall-clock metadata (should not happen for .rcnx — see module
      // doc): append immediately after the previous segment ends, zero gap.
      segmentStartWallMs = runningEndWallMs
    }
    const anchor = firstWallMs ?? 0
    const offsetMs = segmentStartWallMs - anchor - rawTime0
    segmentOffsetsMs.push(offsetMs)

    const rawLast = segTimeData[i][segTimeData[i].length - 1]
    runningEndWallMs = segmentStartWallMs + (rawLast - rawTime0)
  }

  // --- Time channel ---
  const timeOut = new Float32Array(totalRows)
  {
    let cursor = 0
    for (let i = 0; i < segments.length; i++) {
      const src = segTimeData[i]
      const off = segmentOffsetsMs[i]
      for (let j = 0; j < src.length; j++) timeOut[cursor + j] = src[j] + off
      cursor += src.length
    }
  }

  // --- union of every other channel name, first-appearance order ---
  const timeChannelNames = new Set(['Time', 'Timer'])
  const unionNames: string[] = []
  const seenNames = new Set<string>()
  for (const seg of segments) {
    for (const ch of seg.channels) {
      if (timeChannelNames.has(ch.name)) continue
      if (seenNames.has(ch.name)) continue
      seenNames.add(ch.name)
      unionNames.push(ch.name)
    }
  }

  const outChannels: Channel[] = [
    { name: 'Time', rawName: 'Time', description: undefined, unit: 'ms', data: timeOut },
  ]

  for (const name of unionNames) {
    const data = new Float32Array(totalRows)
    let rawName = name
    let description: string | undefined
    let unit: string | undefined
    let haveMeta = false

    if (monotonicNames.has(name)) {
      let runningOffset = 0
      let cursor = 0
      for (const seg of segments) {
        const rows = seg.timeChannel!.data.length
        const src = seg.get(name)
        if (src) {
          if (!haveMeta) {
            rawName = src.rawName
            description = src.description
            unit = src.unit
            haveMeta = true
          }
          let segMax = -Infinity
          for (let j = 0; j < rows; j++) {
            const v = src.data[j]
            const shifted = v + runningOffset
            data[cursor + j] = shifted
            if (v > segMax) segMax = v
          }
          if (segMax > -Infinity) runningOffset += segMax
        } else {
          for (let j = 0; j < rows; j++) data[cursor + j] = NaN
        }
        cursor += rows
      }
    } else {
      let cursor = 0
      for (const seg of segments) {
        const rows = seg.timeChannel!.data.length
        const src = seg.get(name)
        if (src) {
          if (!haveMeta) {
            rawName = src.rawName
            description = src.description
            unit = src.unit
            haveMeta = true
          }
          for (let j = 0; j < rows; j++) data[cursor + j] = src.data[j]
        } else {
          for (let j = 0; j < rows; j++) data[cursor + j] = NaN
        }
        cursor += rows
      }
    }

    outChannels.push({ name, rawName, description, unit, data })
  }

  return { channels: outChannels, segmentRowCounts, segmentOffsetsMs }
}
