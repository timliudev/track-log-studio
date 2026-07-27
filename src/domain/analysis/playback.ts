import type { Lap } from '@/domain/model/Lap'

/**
 * ⑤/⑥ — track-map card playback (docs/ISSUES.md next-up items 05/06 half 1).
 * Pure domain module for the ▶/⏸ control in `cards/MapCard.vue`: which
 * sample-index span to play across (mirrors the deleted mobile scrubber's
 * `scrubberDomain` — see `git show d5d7c2e:src/domain/analysis/scrubber.ts`),
 * how far to advance per animation frame along the recording's OWN time axis,
 * and how to decompose "how far along" into a whole sample index PLUS a
 * fractional remainder so the map marker can glide between two GPS fixes
 * instead of hopping — the fix for "看起來卡卡" (10Hz data = a visible 100ms
 * stutter at 1x).
 *
 * `cursorIdx` (the shared store cursor every OTHER consumer reads) stays an
 * INTEGER — this module's `PlaybackPosition.frac` is a SEPARATE, map-only
 * companion (`analyzerStore.cursorFrac`) that a normal `setCursor` call
 * resets to 0. See analyzerStore.ts's `setCursorAt`.
 */

/** The playback span — a session sample-index range `[startIdx, endIdx]`
 *  (inclusive both ends, matching `Lap`'s own startIdx/endIdx). */
export interface PlaybackDomain {
  startIdx: number
  endIdx: number
}

/**
 * The playback domain: exactly ONE selected lap -> that lap's own sample
 * span; zero or 2+ selected laps -> the full session. `null` when there's
 * nothing to play — no samples, or a degenerate (<2-sample) span, including
 * a selected lap whose own span collapses to <2 samples after clamping to
 * the session's actual sample count. Same rule as the deleted scrubber's
 * `scrubberDomain`.
 */
export function playbackDomain(selectedLaps: readonly Lap[], sampleCount: number): PlaybackDomain | null {
  if (!Number.isFinite(sampleCount) || sampleCount < 2) return null
  const maxIdx = sampleCount - 1
  if (selectedLaps.length === 1) {
    const lap = selectedLaps[0]
    const startIdx = Math.max(0, Math.min(lap.startIdx, maxIdx))
    const endIdx = Math.max(0, Math.min(lap.endIdx, maxIdx))
    if (!(endIdx > startIdx)) return null
    return { startIdx, endIdx }
  }
  return { startIdx: 0, endIdx: maxIdx }
}

/** Clamp a plain sample index into `domain`'s span (rounds toward the
 *  nearest whole sample; a non-finite index reads as the domain start). */
export function clampIndexToDomain(domain: PlaybackDomain, idx: number): number {
  const rounded = Number.isFinite(idx) ? Math.round(idx) : domain.startIdx
  return Math.max(domain.startIdx, Math.min(domain.endIdx, rounded))
}

/** A playback position: a whole sample index PLUS the fraction of the way
 *  from `idx` to `idx + 1` (0 at exactly `idx`, approaching 1 just before
 *  `idx + 1`). Never carries a non-zero fraction at the domain's own end
 *  (there's no `endIdx + 1` sample to glide toward). */
export interface PlaybackPosition {
  idx: number
  frac: number
}

/** Clamp a `PlaybackPosition` into `domain` — the idx half via
 *  `clampIndexToDomain` (truncated first, since only `frac` should ever
 *  carry a fractional amount), the frac half to `[0, 1]` (and forced to 0
 *  once `idx` is clamped to the domain end). Non-finite inputs fall back to
 *  the domain start at frac 0. */
export function clampPosition(domain: PlaybackDomain, position: PlaybackPosition): PlaybackPosition {
  const rawIdx = Number.isFinite(position.idx) ? Math.trunc(position.idx) : domain.startIdx
  const idx = clampIndexToDomain(domain, rawIdx)
  if (idx >= domain.endIdx) return { idx, frac: 0 }
  const frac = Number.isFinite(position.frac) ? Math.max(0, Math.min(1, position.frac)) : 0
  return { idx, frac }
}

/** The absolute time (ms, on `timeMs`'s own axis) a (clamped) position
 *  represents — `timeMs[idx]`, or the linear blend toward `timeMs[idx + 1]`
 *  when `frac > 0`. `null` when the relevant sample(s) aren't finite. */
function positionTimeMs(domain: PlaybackDomain, timeMs: Float64Array, position: PlaybackPosition): number | null {
  const t0 = timeMs[position.idx]
  if (!Number.isFinite(t0)) return null
  if (position.frac > 0 && position.idx < domain.endIdx) {
    const t1 = timeMs[position.idx + 1]
    if (Number.isFinite(t1)) return t0 + position.frac * (t1 - t0)
  }
  return t0
}

/**
 * Advance a playback position within `domain` by `deltaMs` of REAL
 * (wall-clock) elapsed time, at `speed`x, by stepping forward along the
 * session's own `timeMs` axis — so playback tracks the RECORDING's pacing
 * (same reasoning as the deleted scrubber's `advanceByTime`). Unlike that
 * integer-only version, this returns a full `PlaybackPosition`: the whole
 * sample the target time has just reached PLUS how far between it and the
 * next sample the target time actually falls, so a caller can interpolate
 * the map marker's on-screen position instead of snapping it.
 *
 * `current` is re-derived from its own absolute time each call (not a
 * running total kept outside this module), so it composes cleanly across
 * frames of uneven length (typical rAF deltas) without drift.
 *
 * Returns `current` (clamped into `domain`) unchanged when `timeMs` is
 * unavailable or `deltaMs`/`speed` aren't positive. Never advances past
 * `domain.endIdx` (frac pinned to 0 there) — the caller stops the play loop
 * once the returned position reaches the domain end (v1 = stop, not loop).
 */
export function advanceByTime(
  domain: PlaybackDomain,
  timeMs: Float64Array | null,
  current: PlaybackPosition,
  deltaMs: number,
  speed = 1,
): PlaybackPosition {
  const cur = clampPosition(domain, current)
  if (!timeMs || !(deltaMs > 0) || !(speed > 0)) return cur
  const curT = positionTimeMs(domain, timeMs, cur)
  if (curT == null) return cur
  const targetT = curT + deltaMs * speed
  // Walk forward while the NEXT sample's own time doesn't overshoot target —
  // same "check next, not current" floor rule as the deleted scrubber (checking
  // current would always take one extra step, since it trivially satisfies
  // "< target" whenever deltaMs > 0).
  let i = cur.idx
  while (i < domain.endIdx && Number.isFinite(timeMs[i + 1]) && timeMs[i + 1] <= targetT) i++
  if (i >= domain.endIdx) return { idx: domain.endIdx, frac: 0 }
  const t0 = timeMs[i]
  const t1 = timeMs[i + 1]
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0)) return { idx: i, frac: 0 }
  const frac = Math.max(0, Math.min(1, (targetT - t0) / (t1 - t0)))
  return { idx: i, frac }
}

/**
 * Interpolate a projected map sample at `idx + frac` — `px[idx], py[idx]`
 * when `frac` is 0 (or there's no usable next sample), otherwise the linear
 * blend toward `px[idx + 1], py[idx + 1]`. This is the ONLY place the map
 * marker's smoothing math lives, shared by `TrackMap.vue`'s
 * `drawCursorMarker` and this module's own tests.
 *
 * `null` when `idx` itself is out of range or its own sample is a gap (no
 * GPS fix, NaN) — same guard `drawCursorMarker` always had. A NaN/missing
 * NEXT sample degrades gracefully to the exact `idx` sample (frac ignored)
 * rather than hiding the marker mid-glide.
 */
export function interpolateSample(
  px: Float64Array,
  py: Float64Array,
  n: number,
  idx: number | null | undefined,
  frac: number,
): { x: number; y: number } | null {
  if (idx == null || idx < 0 || idx >= n || Number.isNaN(px[idx]) || Number.isNaN(py[idx])) return null
  const f = Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0
  const hasNext = f > 0 && idx + 1 < n && !Number.isNaN(px[idx + 1]) && !Number.isNaN(py[idx + 1])
  if (!hasNext) return { x: px[idx], y: py[idx] }
  return { x: px[idx] + (px[idx + 1] - px[idx]) * f, y: py[idx] + (py[idx + 1] - py[idx]) * f }
}
