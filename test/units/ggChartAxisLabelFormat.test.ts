import { describe, it, expect } from 'vitest'
import { axisLabelDecimals, formatAxisTick } from '@/features/analyzer/GgChart.vue'

/**
 * #5 regression test — "XY 散佈圖 1:1 模式下 Y 軸數值顯示小數點後太多位,把圖表
 * 繪圖區擠壓變形".
 *
 * Root cause (see GgChart.vue's `buildOption`): #6's 1:1 mode widens the
 * smaller-span axis to match the larger one (`squareAxisRanges`) so both
 * axes cover the SAME numeric span for a literal square grid box — but the
 * widened min/max usually isn't a "nice" number the way echarts' own
 * auto-ranging always picks, so its default axis-label formatting could
 * print long floats (e.g. `-0.3333333`). The grid box is drawn at a FIXED
 * pixel chrome (`containLabel: false`), so an unexpectedly wide label column
 * pushes into — and visually squeezes — the plotting area, breaking the
 * square aspect.
 *
 * The fix caps each pinned axis's label precision from its own SPAN (not the
 * individual tick value, so every tick on one axis renders at the same
 * precision) via `axisLabelDecimals`/`formatAxisTick`, wired into the
 * `xAxis`/`yAxis` `axisLabel.formatter` only when that axis's range is
 * pinned (`square`/`equal` 1:1 modes) — the normal auto-ranging axis is left
 * to echarts' own (already-nice) default formatting.
 */
describe('axisLabelDecimals (#5 — 1:1 axis label precision)', () => {
  it('uses 0 decimals for a large span', () => {
    expect(axisLabelDecimals(8000)).toBe(0)
    expect(axisLabelDecimals(100)).toBe(0)
  })

  it('uses 1 decimal for a medium span', () => {
    expect(axisLabelDecimals(50)).toBe(1)
    expect(axisLabelDecimals(10)).toBe(1)
  })

  it('uses 2 decimals for a unit-ish span (e.g. a G-force friction circle)', () => {
    expect(axisLabelDecimals(2)).toBe(2)
    expect(axisLabelDecimals(1)).toBe(2)
  })

  it('uses more decimals for a sub-unit span, capped at a small number', () => {
    expect(axisLabelDecimals(0.5)).toBe(3)
    expect(axisLabelDecimals(0.05)).toBe(4)
  })

  it('falls back to 2 decimals for a degenerate (non-finite/zero/negative) span', () => {
    expect(axisLabelDecimals(0)).toBe(2)
    expect(axisLabelDecimals(-1)).toBe(2)
    expect(axisLabelDecimals(NaN)).toBe(2)
    expect(axisLabelDecimals(Infinity)).toBe(2)
  })
})

describe('formatAxisTick (#5 — compact, non-squashing axis tick labels)', () => {
  it('rounds a long float to the span-appropriate precision (the reported bug)', () => {
    // squareAxisRanges widening a small span against a larger one commonly
    // produces exactly this kind of repeating-decimal min/max.
    expect(formatAxisTick(-0.3333333333, 2)).toBe('-0.33')
    expect(formatAxisTick(1.66666667, 8)).toBe('1.67')
    expect(formatAxisTick(1.66666667, 20)).toBe('1.7')
  })

  it('trims trailing zeros for a compact label', () => {
    expect(formatAxisTick(2, 2)).toBe('2')
    expect(formatAxisTick(2.5, 2)).toBe('2.5')
  })

  it('normalises -0 to 0', () => {
    expect(formatAxisTick(-0.00001, 2)).toBe('0')
    expect(formatAxisTick(-0, 2)).toBe('0')
  })

  it('keeps whole-number labels compact on a large-span axis (e.g. RPM vs speed)', () => {
    expect(formatAxisTick(4000, 8000)).toBe('4000')
    expect(formatAxisTick(150, 200)).toBe('150')
  })
})
