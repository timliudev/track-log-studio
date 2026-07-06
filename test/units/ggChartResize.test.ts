import { describe, it, expect } from 'vitest'
import { measuredSize } from '@/features/analyzer/GgChart.vue'

/**
 * T3 regression — "新增的 XY 圖(scatter)不隨視窗大小變化".
 *
 * GgChart is init'd with an EXPLICIT `{width, height}` (first-frame safety),
 * and zrender remembers init-time explicit sizes in its painter opts: an
 * argument-less `chart.resize()` re-reads those stored numbers instead of
 * measuring the container (zrender `getSize`), so the chart stayed frozen at
 * its mount-time size forever. The fix passes `measuredSize(...)` to every
 * `resize()` call so the stored opts are overwritten with the host's current
 * measurements — these tests pin the measurement rule.
 */
describe('measuredSize (T3 — echarts explicit resize sizing)', () => {
  it('uses the measured host size in fillHeight mode', () => {
    expect(measuredSize(800, 300, true, 360)).toEqual({ width: 800, height: 300 })
  })

  it('uses the fixed height prop when not fillHeight (width still follows the host)', () => {
    expect(measuredSize(800, 300, false, 360)).toEqual({ width: 800, height: 360 })
  })

  it('falls back before the host has laid out (0×0)', () => {
    expect(measuredSize(0, 0, true, 360)).toEqual({ width: 400, height: 360 })
    expect(measuredSize(0, 0, false, 360)).toEqual({ width: 400, height: 360 })
  })
})
