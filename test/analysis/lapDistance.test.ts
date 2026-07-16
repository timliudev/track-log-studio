import { describe, expect, it } from 'vitest'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import { lapDistanceM } from '@/domain/analysis/lapDistance'
import { computeMetric } from '@/domain/analysis/lapMetrics'
import { suggestLapDistanceBand } from '@/domain/analysis/lapValidity'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'

function track(): GpsTrack {
  return {
    lat: new Float64Array(11).fill(0),
    lon: Float64Array.from({ length: 11 }, (_, i) => i * 0.001),
    valid: new Uint8Array(11).fill(1),
  }
}

describe('lapDistanceM', () => {
  it('keeps the table metric and band suggestion on the same in-range boundary', () => {
    const gps = track()
    const cumulative = cumulativeDistanceM(gps.lat, gps.lon, gps.valid)
    const lap: Lap = { index: 0, startIdx: 0, endIdx: gps.lat.length - 1, lapTimeMs: 50_000 }

    const expected = lapDistanceM(lap, cumulative)
    expect(computeMetric({ kind: 'distance' }, lap, { session: null, cumDistM: cumulative })).toBeCloseTo(expected)

    const band = suggestLapDistanceBand(gps, [lap])
    expect(band).not.toBeNull()
    expect(band!.minM).toBeCloseTo(expected * 0.8)
    expect(band!.maxM).toBeCloseTo(expected * 1.2)
  })

  it('treats a zero-width, unavailable, or out-of-range span as unknown', () => {
    const cumulative = cumulativeDistanceM(track().lat, track().lon, track().valid)
    expect(lapDistanceM({ startIdx: 3, endIdx: 3 }, cumulative)).toBeNaN()
    expect(lapDistanceM({ startIdx: 0, endIdx: cumulative.length }, cumulative)).toBeNaN()
    expect(lapDistanceM({ startIdx: 0, endIdx: 1 }, null)).toBeNaN()
  })
})
