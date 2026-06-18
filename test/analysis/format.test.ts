import { describe, it, expect } from 'vitest'
import { formatLapTime } from '@/domain/analysis/format'

describe('formatLapTime', () => {
  it('formats minutes:seconds.millis', () => {
    expect(formatLapTime(92345)).toBe('1:32.345')
  })

  it('zero-pads seconds and millis', () => {
    expect(formatLapTime(61005)).toBe('1:01.005')
    expect(formatLapTime(5000)).toBe('0:05.000')
  })

  it('clamps non-positive and non-finite input to 0', () => {
    expect(formatLapTime(0)).toBe('0:00.000')
    expect(formatLapTime(-1)).toBe('0:00.000')
    expect(formatLapTime(NaN)).toBe('0:00.000')
  })
})
