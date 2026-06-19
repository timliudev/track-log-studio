import { describe, it, expect } from 'vitest'
import { formatElapsed, formatDistance, formatClock } from '@/domain/analysis/axisFormat'

describe('formatElapsed', () => {
  it('formats sub-hour durations as m:ss', () => {
    expect(formatElapsed(90)).toBe('1:30')
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(5)).toBe('0:05')
    expect(formatElapsed(599)).toBe('9:59')
  })

  it('formats >= 1h durations as h:mm:ss', () => {
    expect(formatElapsed(3661)).toBe('1:01:01')
    expect(formatElapsed(3600)).toBe('1:00:00')
  })

  it('rounds to whole seconds', () => {
    expect(formatElapsed(89.6)).toBe('1:30')
  })

  it('renders non-finite or negative as an em dash', () => {
    expect(formatElapsed(NaN)).toBe('—')
    expect(formatElapsed(-5)).toBe('—')
    expect(formatElapsed(Infinity)).toBe('—')
  })
})

describe('formatDistance', () => {
  it('formats metres below 1000', () => {
    expect(formatDistance(500)).toBe('500 m')
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(999)).toBe('999 m')
  })

  it('formats kilometres at or above 1000 with trimmed decimals', () => {
    expect(formatDistance(1500)).toBe('1.5 km')
    expect(formatDistance(12340)).toBe('12.34 km')
    expect(formatDistance(2000)).toBe('2 km')
    expect(formatDistance(1000)).toBe('1 km')
  })

  it('renders non-finite as an em dash', () => {
    expect(formatDistance(NaN)).toBe('—')
    expect(formatDistance(Infinity)).toBe('—')
  })
})

describe('formatClock', () => {
  it('formats an instant at a given offset as HH:mm:ss', () => {
    // 2020-01-01T00:00:00Z + 8h = 08:00:00 local
    const epoch = Date.UTC(2020, 0, 1, 0, 0, 0)
    expect(formatClock(epoch, 480)).toBe('08:00:00')
  })

  it('zero-pads each component', () => {
    const epoch = Date.UTC(2020, 0, 1, 1, 2, 3)
    expect(formatClock(epoch, 0)).toBe('01:02:03')
  })

  it('wraps past midnight', () => {
    // 23:30:00Z + 1h = 00:30:00 next day
    const epoch = Date.UTC(2020, 0, 1, 23, 30, 0)
    expect(formatClock(epoch, 60)).toBe('00:30:00')
  })

  it('renders non-finite as an em dash', () => {
    expect(formatClock(NaN, 480)).toBe('—')
    expect(formatClock(Date.UTC(2020, 0, 1), NaN)).toBe('—')
  })
})
