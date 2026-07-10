import { describe, it, expect } from 'vitest'
import { colorExtent, type GgSeries } from '@/features/analyzer/GgChart.vue'

// Colour-axis feature — the [min,max] domain visualMap needs to build the
// colorbar, derived from every series' colorValues (see ScatterChart.vue's
// colour-axis picker).
describe('colorExtent (colour-axis feature)', () => {
  it('returns null when no series carries colorValues (feature off)', () => {
    const series: GgSeries[] = [{ points: [[0, 0], [1, 1]], color: '#4363d8', name: 'session' }]
    expect(colorExtent(series)).toBeNull()
  })

  it('returns the [min,max] across a single series colorValues', () => {
    const series: GgSeries[] = [
      { points: [[0, 0], [1, 1], [2, 2]], color: '#4363d8', name: 'session', colorValues: [10, 30, 20] },
    ]
    expect(colorExtent(series)).toEqual({ min: 10, max: 30 })
  })

  it('spans across MULTIPLE series (e.g. per-lap split) sharing one colour scale', () => {
    const series: GgSeries[] = [
      { points: [[0, 0]], color: '#e6194b', name: 'lap1', colorValues: [5] },
      { points: [[1, 1]], color: '#3cb44b', name: 'lap2', colorValues: [50] },
    ]
    expect(colorExtent(series)).toEqual({ min: 5, max: 50 })
  })

  it('ignores non-finite colour values but still contributes from finite ones (single finite value widens like a constant channel)', () => {
    const series: GgSeries[] = [
      { points: [[0, 0], [1, 1]], color: '#4363d8', name: 'session', colorValues: [NaN, 15] },
    ]
    expect(colorExtent(series)).toEqual({ min: 14.25, max: 15.75 })
  })

  it('widens a degenerate (constant) colour channel to a non-zero span', () => {
    const series: GgSeries[] = [
      { points: [[0, 0], [1, 1]], color: '#4363d8', name: 'session', colorValues: [7, 7] },
    ]
    const ext = colorExtent(series)!
    expect(ext.min).toBeLessThan(7)
    expect(ext.max).toBeGreaterThan(7)
  })

  it('falls back to ±1 around zero for a constant-zero channel', () => {
    const series: GgSeries[] = [
      { points: [[0, 0]], color: '#4363d8', name: 'session', colorValues: [0, 0] },
    ]
    expect(colorExtent(series)).toEqual({ min: -1, max: 1 })
  })
})
