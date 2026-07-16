import { describe, expect, it } from 'vitest'
import {
  channelUpdateRateGroup,
  inferChannelUpdateRateHz,
  representativeUpdateRateHz,
  summarizeChannelUpdateRates,
} from '@/domain/analysis/channelUpdateRate'

describe('inferChannelUpdateRateHz', () => {
  it('uses the median interval between samples where the value changes', () => {
    const values = [10, 11, 11, 12, 12, 12, 13, 13, 14]
    const seconds = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0]
    // Change events at 0.1, 0.3, 0.6 and 1.0 seconds: median interval = 0.3 s.
    expect(inferChannelUpdateRateHz(values, seconds)).toBeCloseTo(1 / 0.3)
  })

  it('returns null for a constant channel or fewer than two change events', () => {
    expect(inferChannelUpdateRateHz([7, 7, 7, 7], [0, 0.1, 0.2, 0.3])).toBeNull()
    expect(inferChannelUpdateRateHz([7, 8, 8, 8], [0, 0.1, 0.2, 0.3])).toBeNull()
  })

  it('ignores non-finite values and non-positive time intervals', () => {
    expect(inferChannelUpdateRateHz(
      [0, 1, Number.NaN, 2, 3, 4],
      [0, 0.1, 0.2, 0.4, 0.4, 0.9],
    )).toBeCloseTo(2.5)
  })
})

describe('channel update-rate groups', () => {
  it('classifies GPS_* case-insensitively and all other channels as ECU', () => {
    expect(channelUpdateRateGroup('GPS_Speed')).toBe('gps')
    expect(channelUpdateRateGroup('gps_lat_deg')).toBe('gps')
    expect(channelUpdateRateGroup('RPM')).toBe('ecu')
    expect(channelUpdateRateGroup('Time')).toBe('ecu')
  })

  it('uses the median finite positive rate as the representative value', () => {
    expect(representativeUpdateRateHz([null, 5, 10, 20])).toBe(10)
    expect(representativeUpdateRateHz([null, Number.NaN, 0])).toBeNull()
  })

  it('summarizes GPS and ECU independently', () => {
    expect(summarizeChannelUpdateRates([
      { name: 'GPS_Lat', rateHz: 5 },
      { name: 'GPS_Speed', rateHz: 10 },
      { name: 'RPM', rateHz: 50 },
      { name: 'TPS', rateHz: 100 },
    ])).toEqual({ gpsHz: 7.5, ecuHz: 75 })
  })
})
