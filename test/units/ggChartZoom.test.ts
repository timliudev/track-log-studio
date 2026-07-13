import { describe, it, expect } from 'vitest'
import { isScatterZoomed, FULL_ZOOM_WINDOW, type ScatterZoomWindow } from '@/features/analyzer/GgChart.vue'

/**
 * B46 — scatter/G-G chart zoom. GgChart.vue is the shared ECharts renderer
 * for BOTH the free XY scatter chart type and the G-G (friction-circle)
 * chart (ScatterChart.vue picks `axisMode` from the actual data, not the
 * channel names — see GgChart.vue's doc) — so this one component's zoom
 * feature covers both chart flavours identically; there is no separate G-G
 * component to wire up.
 *
 * `isScatterZoomed` mirrors UPlotChart's `isZoomed` (B9): it drives the
 * reset-zoom button's visibility from ECharts' own 0..100 dataZoom
 * percentages rather than data-range values.
 */
describe('isScatterZoomed', () => {
  it('is false for the full 0..100 window on both axes', () => {
    expect(isScatterZoomed(FULL_ZOOM_WINDOW)).toBe(false)
    expect(isScatterZoomed({ xStart: 0, xEnd: 100, yStart: 0, yEnd: 100 })).toBe(false)
  })

  it('is true when only the X axis is zoomed', () => {
    const w: ScatterZoomWindow = { xStart: 10, xEnd: 90, yStart: 0, yEnd: 100 }
    expect(isScatterZoomed(w)).toBe(true)
  })

  it('is true when only the Y axis is zoomed', () => {
    const w: ScatterZoomWindow = { xStart: 0, xEnd: 100, yStart: 20, yEnd: 80 }
    expect(isScatterZoomed(w)).toBe(true)
  })

  it('is true when both axes are zoomed', () => {
    const w: ScatterZoomWindow = { xStart: 15, xEnd: 60, yStart: 5, yEnd: 95 }
    expect(isScatterZoomed(w)).toBe(true)
  })

  it('is true for a pure pan (same span, shifted start/end)', () => {
    const w: ScatterZoomWindow = { xStart: 10, xEnd: 110 - 10, yStart: 0, yEnd: 100 }
    // (kept span 100 but shifted start — still not the full 0..100 window)
    expect(isScatterZoomed({ ...w, xEnd: 90 })).toBe(true)
  })

  it('tolerates float-precision noise right at the full-window boundary', () => {
    const w: ScatterZoomWindow = { xStart: 1e-9, xEnd: 100 - 1e-9, yStart: 0, yEnd: 100 }
    expect(isScatterZoomed(w)).toBe(false)
  })

  it('respects a custom epsilon', () => {
    const w: ScatterZoomWindow = { xStart: 0.01, xEnd: 100, yStart: 0, yEnd: 100 }
    expect(isScatterZoomed(w, 0.001)).toBe(true)
    expect(isScatterZoomed(w, 0.1)).toBe(false)
  })
})
