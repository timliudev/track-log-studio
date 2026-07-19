export interface Point2D {
  x: number
  y: number
}

export interface Rect2D {
  left: number
  top: number
  width: number
  height: number
}

export interface CentreNeedleGeometry {
  left: number
  top: number
  height: number
}

export type PendingTouchIntent = 'pending' | 'pan' | 'scroll'

/**
 * Place the fixed needle at the plotting area's centre and clip its vertical
 * extent to the plotting rectangle inside the surrounding wrapper.
 */
export function centreNeedleGeometry(
  wrapper: Rect2D,
  plottingArea: Rect2D,
): CentreNeedleGeometry | null {
  if (!(wrapper.width > 0) || !(wrapper.height > 0) || !(plottingArea.width > 0) || !(plottingArea.height > 0)) {
    return null
  }
  const clampX = (x: number): number => Math.min(wrapper.width, Math.max(0, x))
  const clampY = (y: number): number => Math.min(wrapper.height, Math.max(0, y))
  const top = clampY(plottingArea.top - wrapper.top)
  const bottom = clampY(plottingArea.top + plottingArea.height - wrapper.top)
  if (!(bottom > top)) return null
  return {
    left: clampX(plottingArea.left - wrapper.left + plottingArea.width / 2),
    top,
    height: bottom - top,
  }
}

/**
 * Resolve a one-finger gesture only after it leaves a small long-press slop:
 * horizontal movement belongs to chart pan, vertical movement belongs to the
 * page, and a stationary pointer remains eligible for long-press selection.
 */
export function pendingTouchIntent(
  start: Point2D,
  current: Point2D,
  slopPx: number,
): PendingTouchIntent {
  const dx = current.x - start.x
  const dy = current.y - start.y
  if (Math.hypot(dx, dy) <= Math.max(0, slopPx)) return 'pending'
  return Math.abs(dx) >= Math.abs(dy) ? 'pan' : 'scroll'
}

/** Keep a persistent touch cursor inside uPlot's interactive plotting area. */
export function clampPlotPoint(point: Point2D, width: number, height: number): Point2D {
  return {
    x: Math.min(Math.max(0, width), Math.max(0, point.x)),
    y: Math.min(Math.max(0, height), Math.max(0, point.y)),
  }
}

/**
 * B94 — whether pointer position `point` (CSS px, e.g. a `PointerEvent`'s own
 * `clientX`/`clientY`) sits in the X-AXIS tick/label band: below uPlot's own
 * interactive plotting rect (`plottingArea`, i.e. `u.over`'s bounding rect —
 * narrower than the full canvas by the y-axis label gutter) but still within
 * the canvas that draws the axes (`canvasArea`, i.e. `u.ctx.canvas`'s
 * bounding rect). uPlot draws every axis directly on that one canvas rather
 * than as separate DOM per axis, so "below the plot, above the canvas' own
 * bottom edge" is the only reliable hit-test — and it naturally covers a
 * second (e.g. clock-time) bottom axis too, since that's drawn further down
 * the SAME canvas rather than in its own element.
 */
export function isPointInAxisBand(point: Point2D, plottingArea: Rect2D, canvasArea: Rect2D): boolean {
  const bandTop = plottingArea.top + plottingArea.height
  const bandBottom = canvasArea.top + canvasArea.height
  if (!(bandBottom > bandTop)) return false
  if (point.y < bandTop || point.y > bandBottom) return false
  return point.x >= plottingArea.left && point.x <= plottingArea.left + plottingArea.width
}
