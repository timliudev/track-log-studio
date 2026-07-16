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
