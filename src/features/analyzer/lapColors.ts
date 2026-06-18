/**
 * Palette for color-by-lap rendering. Hand-picked hues that stay distinct and
 * legible against both the light and dark map backgrounds. (Raw hexes are an
 * intentional exception to the CSS-var rule: we need N fixed, distinct hues
 * that don't depend on the theme.)
 */
export const LAP_COLORS: readonly string[] = [
  '#e6194b', // red
  '#3cb44b', // green
  '#4363d8', // blue
  '#f58231', // orange
  '#911eb4', // purple
  '#008080', // teal
  '#f032e6', // magenta
  '#bcf60c', // lime
]

/** Color for the Nth selected lap (by selection order), cycling the palette. */
export function lapColor(order: number): string {
  return LAP_COLORS[order % LAP_COLORS.length]
}
