/**
 * Marker-shape identity for "the Nth file in a multi-file XY scatter" (B25).
 *
 * The scatter/G-G chart's optional colour axis (a third channel mapped to a
 * continuous colormap — see ggData.ts/GgChart.vue's colour-axis feature)
 * needs hue for ITSELF once picked. That used to collide with
 * `categoricalColor(fileId)` (colorPalette.ts), which owns hue for "which
 * file is this point from" in the multi-session scatter — picking a colour
 * axis with more than one file selected silently broke one or the other
 * (see MULTI-SESSION-ANALYSIS-DESIGN.md §4's colour-conflict note, which
 * flagged this exact clash as unresolved). The decided fix: when the colour
 * axis is active, hue goes ENTIRELY to the third-channel gradient (whether
 * one file or several are plotted), and file identity moves to marker SHAPE
 * instead — this module is the stable index→shape mapping for that.
 *
 * Shapes are ECharts symbol names directly (both scatter markers and legend
 * icons accept the same strings — see GgChart.vue's legend wiring), assigned
 * by the file's POSITION in the comparison list (index 0 = primary = circle,
 * index 1 = first comparison = triangle, …), matching FileBar's/the global
 * comparison list's own order — not the file's numeric id, which can be
 * sparse or reordered after files are removed.
 */
export const MARKER_SHAPES = ['circle', 'triangle', 'rect', 'diamond', 'pin', 'arrow'] as const

export type MarkerShape = (typeof MARKER_SHAPES)[number]

/**
 * Marker shape for the Nth file (by its position in the comparison list —
 * primary first, then comparisons in selection order), cycling the palette
 * above once more files are selected than there are shapes. Negative indices
 * wrap the same as positive ones (same convention as `categoricalColor`).
 */
export function markerShapeForIndex(index: number): MarkerShape {
  const n = MARKER_SHAPES.length
  const i = ((index % n) + n) % n
  return MARKER_SHAPES[i]
}
