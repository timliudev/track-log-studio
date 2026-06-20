/**
 * Sequential / diverging colormaps for the track heatmap (#11). Each is a small
 * list of RGB control points; {@link sampleColormap} linearly interpolates
 * between them. The hand-picked anchors approximate well-known perceptual
 * colormaps (turbo/viridis/plasma) closely enough for on-track gradient reading.
 *
 * Raw RGB triples are an intentional exception to the CSS-var rule (same as
 * lapColors): we need fixed, theme-independent gradients so a given channel
 * value maps to the same colour in light and dark mode.
 */
export type ColormapId = 'turbo' | 'viridis' | 'plasma' | 'coolwarm'

type Rgb = readonly [number, number, number]

/** Control-point stops, evenly spaced over [0, 1], low → high. */
const STOPS: Record<ColormapId, readonly Rgb[]> = {
  // Google Turbo — blue → cyan → green → yellow → red, perceptually ordered.
  turbo: [
    [48, 18, 59],
    [70, 107, 227],
    [40, 177, 228],
    [42, 218, 162],
    [142, 234, 79],
    [225, 220, 55],
    [253, 165, 49],
    [231, 84, 28],
    [122, 4, 3],
  ],
  // Viridis — colour-blind-friendly purple → teal → yellow.
  viridis: [
    [68, 1, 84],
    [62, 74, 137],
    [49, 104, 142],
    [38, 130, 142],
    [31, 158, 137],
    [53, 183, 121],
    [110, 206, 88],
    [181, 222, 43],
    [253, 231, 37],
  ],
  // Plasma — dark blue → magenta → orange → yellow.
  plasma: [
    [13, 8, 135],
    [84, 2, 163],
    [139, 10, 165],
    [185, 50, 137],
    [219, 92, 104],
    [244, 136, 73],
    [254, 188, 43],
    [240, 249, 33],
  ],
  // Coolwarm — diverging blue → grey → red (good for signed-ish channels, e.g. G).
  coolwarm: [
    [59, 76, 192],
    [144, 178, 254],
    [220, 220, 220],
    [246, 158, 123],
    [180, 4, 38],
  ],
}

/** All colormap ids in display order (first = default). */
export const COLORMAP_IDS = Object.keys(STOPS) as ColormapId[]

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)
const lerp = (a: number, b: number, f: number): number => a + (b - a) * f

/**
 * Colour at position `t` ∈ [0, 1] along `id`, as an `rgb(r, g, b)` string.
 * Non-finite `t` is treated as 0; out-of-range is clamped.
 */
export function sampleColormap(id: ColormapId, t: number): string {
  const stops = STOPS[id]
  const u = clamp01(Number.isFinite(t) ? t : 0) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(u))
  const f = u - i
  const a = stops[i]
  const b = stops[i + 1]
  const r = Math.round(lerp(a[0], b[0], f))
  const g = Math.round(lerp(a[1], b[1], f))
  const bl = Math.round(lerp(a[2], b[2], f))
  return `rgb(${r}, ${g}, ${bl})`
}

/**
 * `steps` evenly spaced colours (a discretised LUT), low → high. Used both to
 * bucket the polyline into a bounded number of strokes and to render the legend
 * gradient. `steps` ≥ 1.
 */
export function colormapSwatches(id: ColormapId, steps: number): string[] {
  const n = Math.max(1, Math.floor(steps))
  const out: string[] = new Array(n)
  for (let i = 0; i < n; i++) out[i] = sampleColormap(id, n === 1 ? 0 : i / (n - 1))
  return out
}
