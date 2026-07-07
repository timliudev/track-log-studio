/**
 * Shared categorical palette for "the Nth colored thing on a chart/map" —
 * hand-picked hues that stay distinct and legible against both the light and
 * dark themes. Originally lived only in features/analyzer/lapColors.ts (lap
 * identity color); pulled into domain so the track-map multi-session overlay
 * (useTrackOverlay.ts) can draw from the SAME palette instead of hand-rolling
 * a second one — one set of hues, two consumers. Raw hexes are an
 * intentional exception to the CSS-var rule: both consumers need N fixed,
 * distinct hues that don't depend on the active theme.
 */
export const CATEGORICAL_COLORS: readonly string[] = [
  '#e6194b', // red
  '#3cb44b', // green
  '#4363d8', // blue
  '#f58231', // orange
  '#911eb4', // purple
  '#008080', // teal
  '#f032e6', // magenta
  '#bcf60c', // lime
]

/** Color for the Nth categorical item (cycling the palette), by any integer
 *  key — negative keys wrap the same as positive ones. */
export function categoricalColor(order: number): string {
  const n = CATEGORICAL_COLORS.length
  const i = ((order % n) + n) % n
  return CATEGORICAL_COLORS[i]
}
