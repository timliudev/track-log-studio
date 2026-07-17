import { describe, expect, it } from 'vitest'
import {
  centreNeedleGeometry,
  clampPlotPoint,
  pendingTouchIntent,
} from '@/domain/analysis/chartPointerGesture'

describe('centreNeedleGeometry', () => {
  it('uses the plotting-area centre and vertical extent relative to the wrapper', () => {
    expect(centreNeedleGeometry(
      { left: 100, top: 50, width: 700, height: 300 },
      { left: 160, top: 80, width: 600, height: 210 },
    )).toEqual({ left: 360, top: 30, height: 210 })
  })

  it('clips the line to the wrapper instead of letting it escape the chart', () => {
    expect(centreNeedleGeometry(
      { left: 100, top: 50, width: 400, height: 200 },
      { left: 50, top: 20, width: 600, height: 300 },
    )).toEqual({ left: 250, top: 0, height: 200 })
  })

  it('returns null before either rectangle has measurable area', () => {
    expect(centreNeedleGeometry(
      { left: 0, top: 0, width: 0, height: 100 },
      { left: 0, top: 0, width: 100, height: 100 },
    )).toBeNull()
  })
})

describe('pendingTouchIntent', () => {
  const start = { x: 100, y: 100 }

  it('keeps a stationary/slightly drifting finger eligible for long press', () => {
    expect(pendingTouchIntent(start, { x: 106, y: 105 }, 10)).toBe('pending')
  })

  it('routes dominant horizontal movement to chart pan', () => {
    expect(pendingTouchIntent(start, { x: 120, y: 104 }, 10)).toBe('pan')
  })

  it('routes dominant vertical movement back to native page scroll', () => {
    expect(pendingTouchIntent(start, { x: 104, y: 120 }, 10)).toBe('scroll')
  })
})

describe('clampPlotPoint', () => {
  it('keeps a touch-selected cursor within the plot bounds', () => {
    expect(clampPlotPoint({ x: -20, y: 300 }, 500, 200)).toEqual({ x: 0, y: 200 })
  })
})
