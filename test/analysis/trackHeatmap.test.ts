import { describe, it, expect } from 'vitest'
import { normalizeChannel } from '@/domain/analysis/trackHeatmap'

describe('normalizeChannel', () => {
  it('maps valid finite values to [0, 1] over the channel min..max', () => {
    const data = new Float32Array([10, 20, 30, 40, 50])
    const valid = new Uint8Array([1, 1, 1, 1, 1])
    const r = normalizeChannel(data, valid)
    expect(r.min).toBe(10)
    expect(r.max).toBe(50)
    expect(Array.from(r.norm)).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('excludes invalid fixes from the range AND marks them NaN', () => {
    const data = new Float32Array([10, 999, 30])
    const valid = new Uint8Array([1, 0, 1]) // middle has no GPS fix
    const r = normalizeChannel(data, valid)
    expect(r.min).toBe(10)
    expect(r.max).toBe(30) // 999 ignored
    expect(r.norm[0]).toBe(0)
    expect(Number.isNaN(r.norm[1])).toBe(true)
    expect(r.norm[2]).toBe(1)
  })

  it('marks non-finite values NaN and skips them in the range', () => {
    const data = new Float32Array([5, NaN, 15])
    const valid = new Uint8Array([1, 1, 1])
    const r = normalizeChannel(data, valid)
    expect(r.min).toBe(5)
    expect(r.max).toBe(15)
    expect(Number.isNaN(r.norm[1])).toBe(true)
  })

  it('yields 0.5 for a degenerate (all-equal) range', () => {
    const data = new Float32Array([7, 7, 7])
    const valid = new Uint8Array([1, 1, 1])
    const r = normalizeChannel(data, valid)
    expect(r.min).toBe(7)
    expect(r.max).toBe(7)
    expect(Array.from(r.norm)).toEqual([0.5, 0.5, 0.5])
  })

  it('returns NaN min/max and all-NaN norm when nothing contributes', () => {
    const data = new Float32Array([1, 2])
    const valid = new Uint8Array([0, 0])
    const r = normalizeChannel(data, valid)
    expect(Number.isNaN(r.min)).toBe(true)
    expect(Number.isNaN(r.max)).toBe(true)
    expect(r.norm.every((v) => Number.isNaN(v))).toBe(true)
  })
})
