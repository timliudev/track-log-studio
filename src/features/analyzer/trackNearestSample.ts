/**
 * 賽道地圖 ↔ 圖表游標連動：滑鼠在地圖上移動時，找出離指標最近的軌跡樣本
 * index，寫回共用的 session-index 游標狀態（analyzerStore.cursorIdx）。
 *
 * Extracted out of TrackMap.vue's onPointerMove (idle-hover branch) as a pure
 * function so the "map pixel → nearest sample index" hit-test is unit
 * testable without mounting the canvas/Vue component. Behaviour is
 * unchanged: same squared-distance nearest-neighbour scan, same hit-radius
 * gate (returns null when nothing is within `hitRadius` px of the pointer,
 * so empty space around the track doesn't snap to the outermost point).
 */

/** One [startIdx, endIdx] span (inclusive, order-agnostic) of `props.track`'s
 *  OWN sample indices — e.g. a currently-selected/highlighted lap on the
 *  active session. Only spans into the ACTIVE track's own index space make
 *  sense here (a cross-file comparison lap indexes into a DIFFERENT track's
 *  samples, so it's never one of these — see nearestSample's doc below). */
export interface SampleIndexRange {
  startIdx: number
  endIdx: number
}

/** Nearest-neighbour scan restricted to `[lo, hi]` (inclusive); returns the
 *  best candidate's index and its squared pixel distance, or `null` if the
 *  range is empty or every sample in it is a gap (NaN px, no GPS fix). No
 *  hit-radius gate here — callers compare against the radius once, after
 *  picking the best candidate across every range under consideration. */
function nearestInRange(
  px: ArrayLike<number>,
  py: ArrayLike<number>,
  x: number,
  y: number,
  lo: number,
  hi: number,
): { index: number; distSq: number } | null {
  let best = -1
  let bestD = Infinity
  for (let i = lo; i <= hi; i++) {
    if (Number.isNaN(px[i])) continue
    const dx = px[i] - x
    const dy = py[i] - y
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best >= 0 ? { index: best, distSq: bestD } : null
}

/**
 * B30b(a) — on a real racetrack (a closed loop) different laps' GPS traces
 * can sit only a few pixels apart on the map, especially when zoomed out. A
 * plain "closest sample in the WHOLE track" scan can therefore snap to a
 * DIFFERENT (unselected) lap's sample even though the pointer is right on
 * top of the currently highlighted/selected lap's own line — which is what
 * broke the map→chart cursor link: the overlay chart's cursor mapping
 * (`gridIndexAtSampleIndex`/`lapContaining` in overlayCursor.ts) only moves
 * when the hit sample actually falls within a SELECTED lap's span, so a
 * near-miss onto a neighbouring lap silently left the chart cursor parked.
 *
 * `preferredRanges` (the currently highlighted laps' own [startIdx, endIdx]
 * spans, in `track`'s own index space) are searched FIRST, together, and
 * whichever candidate among them is closest wins as long as it's within
 * `hitRadius` — even if a slightly closer sample exists OUTSIDE every
 * preferred range. Only when nothing in the preferred ranges is close enough
 * (or none were given — the "no lap selected" / plain hover case) does this
 * fall back to the full-track scan, i.e. today's unchanged behaviour. This
 * also naturally implements "hovering an unselected part of the track does
 * nothing extra" — with no preferred ranges in play there, or when the
 * pointer is nowhere near them, the full-track scan is exactly what ran
 * before this feature.
 */
export function nearestSample(
  px: ArrayLike<number>,
  py: ArrayLike<number>,
  x: number,
  y: number,
  hitRadius: number,
  preferredRanges?: readonly SampleIndexRange[],
): number | null {
  const hit = hitRadius * hitRadius

  if (preferredRanges && preferredRanges.length > 0) {
    let best: { index: number; distSq: number } | null = null
    for (const range of preferredRanges) {
      const lo = Math.max(0, Math.min(range.startIdx, range.endIdx))
      const hi = Math.min(px.length - 1, Math.max(range.startIdx, range.endIdx))
      if (lo > hi) continue
      const candidate = nearestInRange(px, py, x, y, lo, hi)
      if (candidate && (!best || candidate.distSq < best.distSq)) best = candidate
    }
    if (best && best.distSq <= hit) return best.index
  }

  const full = nearestInRange(px, py, x, y, 0, px.length - 1)
  return full && full.distSq <= hit ? full.index : null
}

/**
 * B30b(b) — map-hover hit radius, in CSS px. User testing found the old fixed
 * 24px required near-max map zoom and precise aim even with a mouse; this
 * widens both the baseline (fine-pointer) radius and — per §8 layer 3's
 * capability-driven touch-target sizing (see useInputCapabilities.ts /
 * DESIGN.md §8) — grows it further on any coarse (touch-capable) pointer,
 * where a fingertip is much less precise than a mouse cursor and typically
 * also occludes the exact point being aimed at.
 */
export const TRACK_HIT_RADIUS_FINE = 32
export const TRACK_HIT_RADIUS_COARSE = 48

/** Picks the hit radius for the current input capability — a plain function
 *  (rather than inlining the ternary at the call site) so the rule itself is
 *  unit-testable without mounting TrackMap.vue or its composable. */
export function resolveTrackHitRadius(anyPointerCoarse: boolean): number {
  return anyPointerCoarse ? TRACK_HIT_RADIUS_COARSE : TRACK_HIT_RADIUS_FINE
}
