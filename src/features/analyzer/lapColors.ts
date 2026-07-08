import { CATEGORICAL_COLORS, categoricalColor } from '@/domain/analysis/colorPalette'

/**
 * Palette for color-by-lap rendering — re-exported from the shared domain
 * palette (see colorPalette.ts) so lap identity color and the track-map
 * multi-session overlay identity color draw from one source instead of two
 * hand-rolled copies. Kept as a re-export (not a straight import at call
 * sites) so existing `LAP_COLORS`/`lapColor` imports across the analyzer
 * feature keep working unchanged.
 */
export const LAP_COLORS: readonly string[] = CATEGORICAL_COLORS

/** Color for the Nth selected lap (by selection order), cycling the palette. */
export const lapColor: (order: number) => string = categoricalColor
