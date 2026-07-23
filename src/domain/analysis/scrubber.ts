import type { Lap } from '@/domain/model/Lap'

/**
 * F1 phase 3 — pure sample-index <-> thumb-fraction mapping for the mobile
 * Focus Stack's bottom time-scrubber (see docs/specs/F1-MOBILE-STACK-DESIGN.md
 * §5/§6). Extracted from `MobileScrubber.vue` so the mapping is testable
 * without mounting a component or touching the DOM.
 *
 * The scrubber does NOT invent a new cursor-sync mechanism: it maps thumb
 * position -> a SESSION SAMPLE INDEX -> `analyzerStore.setCursor` (called by
 * AnalyzerView, which owns all store wiring — see that file's `onScrubberScrub`).
 * Every other cursor consumer (track map, timeline charts, and — via the
 * EXISTING reverse-link in `TimeSeriesChart.vue`'s `effectiveCursor`, built on
 * `lapContaining`/`gridIndexAtSampleIndex` from `overlayCursor.ts` — overlay
 * charts too) already follows `cursorIdx` for free. This module intentionally
 * does NOT duplicate that overlay grid-index mapping; it only produces the
 * session-sample-index half of the signal, same as the map/B31 needle do.
 */

/** The scrubber's domain: a session sample-index span `[startIdx, endIdx]`
 *  (inclusive both ends, matching `Lap`'s own startIdx/endIdx + the
 *  `overlayCursor.ts` helpers' inclusive-endIdx convention). */
export interface ScrubberDomain {
  startIdx: number
  endIdx: number
}

/**
 * The scrubber's domain: exactly ONE selected lap -> that lap's own sample
 * span; zero or 2+ selected laps -> the full session. `null` when there's
 * nothing to scrub — no samples, or a degenerate (<2-sample) span, including
 * a selected lap whose own span collapses to <2 samples after clamping to
 * the session's actual sample count.
 */
export function scrubberDomain(selectedLaps: readonly Lap[], sampleCount: number): ScrubberDomain | null {
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

/** Clamp (and round to the nearest integer sample) an index into `domain`'s
 *  span. */
export function clampToDomain(domain: ScrubberDomain, sampleIdx: number): number {
  const rounded = Number.isFinite(sampleIdx) ? Math.round(sampleIdx) : domain.startIdx
  return Math.max(domain.startIdx, Math.min(domain.endIdx, rounded))
}

/** Thumb fraction `[0, 1]` -> a session sample index within `domain`
 *  (rounded to the nearest integer sample, clamped to the domain). A
 *  non-finite fraction is treated as `0` (domain start) rather than
 *  propagating `NaN`. */
export function fractionToSampleIndex(domain: ScrubberDomain, fraction: number): number {
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0
  return clampToDomain(domain, domain.startIdx + f * (domain.endIdx - domain.startIdx))
}

/** Session sample index -> thumb fraction `[0, 1]` within `domain` (clamped
 *  to the domain first). A degenerate (single-sample) domain reads as `0`
 *  rather than `NaN`. */
export function sampleIndexToFraction(domain: ScrubberDomain, sampleIdx: number): number {
  const span = domain.endIdx - domain.startIdx
  if (!(span > 0)) return 0
  const clamped = Math.max(domain.startIdx, Math.min(domain.endIdx, sampleIdx))
  return (clamped - domain.startIdx) / span
}

/** Elapsed milliseconds from `domain`'s start to `sampleIdx` (clamped into
 *  the domain first), using the session's own time axis — the value the
 *  `m:ss.mmm` readout formats (via `formatLapTime`, `format.ts`). `null`
 *  when `timeMs` is unavailable or the resolved samples are non-finite. */
export function elapsedMsInDomain(
  domain: ScrubberDomain,
  timeMs: Float64Array | null,
  sampleIdx: number,
): number | null {
  if (!timeMs) return null
  const clamped = clampToDomain(domain, sampleIdx)
  const t0 = timeMs[domain.startIdx]
  const t = timeMs[clamped]
  if (!Number.isFinite(t0) || !Number.isFinite(t)) return null
  return t - t0
}

/** Total domain duration in ms (the track's "total time" label) — elapsed
 *  time from `domain.startIdx` to `domain.endIdx`. `null` when `timeMs` is
 *  unavailable. */
export function domainDurationMs(domain: ScrubberDomain, timeMs: Float64Array | null): number | null {
  return elapsedMsInDomain(domain, timeMs, domain.endIdx)
}

/**
 * F1 phase 4 — advance a sample index within `domain` by `deltaMs` of REAL
 * (wall-clock) elapsed time, at `speed`x, by stepping forward along the
 * session's own `timeMs` axis — so playback tracks the RECORDING's pacing
 * (not a naive "1 sample per tick", which would run at wildly different
 * speeds across sessions logged at different sample rates). Playback only
 * ever moves forward (`currentIdx` is always where the last frame left off),
 * so a linear forward scan from `currentIdx` is O(1) amortized across an
 * entire play session rather than O(n) per frame.
 *
 * Returns `currentIdx` unchanged (clamped into `domain`) when `timeMs` is
 * unavailable or `deltaMs` isn't positive. Never advances past
 * `domain.endIdx` — the caller (`MobileScrubber.vue`) stops the play loop
 * once the returned index reaches the domain end (v1 = stop, not loop; see
 * design doc §10 phase 4).
 */
export function advanceByTime(
  domain: ScrubberDomain,
  timeMs: Float64Array | null,
  currentIdx: number,
  deltaMs: number,
  speed = 1,
): number {
  const cur = clampToDomain(domain, currentIdx)
  if (!timeMs || !(deltaMs > 0) || !(speed > 0)) return cur
  const t0 = timeMs[cur]
  if (!Number.isFinite(t0)) return cur
  const targetT = t0 + deltaMs * speed
  // Floor to the LAST sample that doesn't overshoot targetT (checking the
  // NEXT sample before stepping, rather than the current one) — advancing
  // while the current sample's own time is still under target would always
  // take one extra step (the current sample trivially satisfies "< target"
  // whenever deltaMs > 0), overshooting by up to one whole sample interval
  // every frame.
  let i = cur
  while (i < domain.endIdx && timeMs[i + 1] <= targetT) i++
  return i
}
