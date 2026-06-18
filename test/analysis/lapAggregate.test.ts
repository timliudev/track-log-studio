import { describe, it, expect } from 'vitest'
import { aggregateChannel } from '@/domain/analysis/lapAggregate'

describe('aggregateChannel', () => {
  it('computes max/min/avg over a known span (inclusive)', () => {
    const data = new Float32Array([10, 40, 55, 80, 30, 5])
    // span [1, 4] -> samples 40, 55, 80, 30
    expect(aggregateChannel(data, 1, 4, 'max')).toBe(80)
    expect(aggregateChannel(data, 1, 4, 'min')).toBe(30)
    expect(aggregateChannel(data, 1, 4, 'avg')).toBeCloseTo((40 + 55 + 80 + 30) / 4, 6)
  })

  it('skips NaN samples for every aggregation', () => {
    const data = new Float32Array([NaN, 60, NaN, 90, 30])
    // span [0, 4] with two NaNs -> 60, 90, 30
    expect(aggregateChannel(data, 0, 4, 'max')).toBe(90)
    expect(aggregateChannel(data, 0, 4, 'min')).toBe(30)
    expect(aggregateChannel(data, 0, 4, 'avg')).toBeCloseTo((60 + 90 + 30) / 3, 6)
  })

  it('returns NaN for an all-NaN span', () => {
    const data = new Float32Array([NaN, NaN, NaN])
    expect(Number.isNaN(aggregateChannel(data, 0, 2, 'max'))).toBe(true)
    expect(Number.isNaN(aggregateChannel(data, 0, 2, 'min'))).toBe(true)
    expect(Number.isNaN(aggregateChannel(data, 0, 2, 'avg'))).toBe(true)
  })

  it('returns NaN for an empty span (lo > hi)', () => {
    const data = new Float32Array([1, 2, 3])
    // startIdx beyond endIdx -> no samples visited
    expect(Number.isNaN(aggregateChannel(data, 2, 1, 'max'))).toBe(true)
  })

  it('clamps endIdx safely when it is >= length', () => {
    const data = new Float32Array([10, 20, 30])
    // endIdx 99 clamps to the last index; max of [0..2] = 30
    expect(aggregateChannel(data, 0, 99, 'max')).toBe(30)
    expect(aggregateChannel(data, 0, 99, 'min')).toBe(10)
  })

  it('clamps a negative startIdx to 0', () => {
    const data = new Float32Array([10, 20, 30])
    expect(aggregateChannel(data, -5, 2, 'avg')).toBeCloseTo(20, 6)
  })

  it('handles a single-sample span', () => {
    const data = new Float32Array([10, 25, 30])
    expect(aggregateChannel(data, 1, 1, 'max')).toBe(25)
    expect(aggregateChannel(data, 1, 1, 'avg')).toBe(25)
  })
})
