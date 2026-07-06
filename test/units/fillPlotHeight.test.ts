import { describe, it, expect } from 'vitest'
import { fillPlotHeight } from '@/components/UPlotChart.vue'

/**
 * T1 regression — "卡片下方的文字被切掉" (dashboard card text clipped).
 *
 * In `fillHeight` mode UPlotChart used to hand uPlot the FULL host height as
 * `options.height`. uPlot's `height` sizes only the plot area + axes, and its
 * HTML legend (which lives inside the same host, below the canvas) adds its
 * own height on top — so canvas + legend always overflowed the host and the
 * legend text was clipped by the card body, at every card/window size
 * (growing the window just grew the canvas, never revealed the legend).
 * The fix subtracts the legend's measured height — see fillPlotHeight's doc
 * in UPlotChart.vue.
 */
describe('fillPlotHeight (T1 — legend-aware fillHeight sizing)', () => {
  it('subtracts the legend height from the host height', () => {
    expect(fillPlotHeight(300, 40, 260)).toBe(260)
    expect(fillPlotHeight(500, 0, 260)).toBe(500)
  })

  it('falls back when the host has not laid out yet (height 0)', () => {
    expect(fillPlotHeight(0, 0, 260)).toBe(260)
  })

  it('falls back when the legend would consume the whole host (no space left)', () => {
    expect(fillPlotHeight(30, 40, 260)).toBe(260)
    expect(fillPlotHeight(40, 40, 260)).toBe(260)
  })
})
