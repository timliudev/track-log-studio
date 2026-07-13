import { describe, it, expect } from 'vitest'
import { isTouchGesturePointer } from '@/components/UPlotChart.vue'

/**
 * B35 — §8 layer 2 ("逐事件判斷，不是逐裝置"): UPlotChart's own pan/pinch
 * gesture handling must fire for `touch` pointer events only. `mouse` is left
 * to uPlot's native drag-box-zoom (+ this file's own Shift+drag pan); `pen`
 * is DELIBERATELY treated the same as `mouse` — not lumped in with touch —
 * since a stylus drag should box-zoom like a mouse, with its native hover
 * support already giving it the rest of the mouse-like experience for free.
 */
describe('isTouchGesturePointer (B35 §8 layer 2)', () => {
  it('is true for touch — the only pointerType this chart\'s own pan/pinch handles', () => {
    expect(isTouchGesturePointer('touch')).toBe(true)
  })

  it('is false for mouse — left to uPlot\'s native drag-zoom', () => {
    expect(isTouchGesturePointer('mouse')).toBe(false)
  })

  it('is false for pen — deliberately treated like mouse, not touch', () => {
    expect(isTouchGesturePointer('pen')).toBe(false)
  })

  it('is false for an unknown/future pointerType (falls back to the native path)', () => {
    expect(isTouchGesturePointer('some-future-pointer-type')).toBe(false)
  })
})
