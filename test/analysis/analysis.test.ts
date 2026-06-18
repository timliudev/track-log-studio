import { describe, it, expect } from 'vitest'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { nmeaToSession } from '@/domain/import/nmea/nmeaToSession'
import { extractGpsTrack, hasGps } from '@/domain/analysis/gpsTrack'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import { lttb } from '@/domain/analysis/downsample'
import { timeSeconds } from '@/domain/analysis/timeAxis'
import { loadFixture } from '../fixtures'

describe('extractGpsTrack', () => {
  it('extracts a Taiwan-area track from a GPS log', () => {
    const track = extractGpsTrack(parseLoga(loadFixture('super2.loga')))
    expect(hasGps(track)).toBe(true)
    const i = track.valid.indexOf(1)
    expect(track.lat[i]).toBeGreaterThan(20)
    expect(track.lat[i]).toBeLessThan(26)
    expect(track.lon[i]).toBeGreaterThan(118)
    expect(track.lon[i]).toBeLessThan(123)
  })

  it('extracts decimal-degree fixes from an NMEA session (fallback path)', () => {
    const track = extractGpsTrack(nmeaToSession(loadFixture('super2.expected.nmea')))
    expect(hasGps(track)).toBe(true)
    const i = track.valid.indexOf(1)
    expect(track.lat[i]).toBeGreaterThan(20)
    expect(track.lat[i]).toBeLessThan(26)
    expect(track.lon[i]).toBeGreaterThan(118)
    expect(track.lon[i]).toBeLessThan(123)
  })

  it('returns no fixes for a log without GPS columns', () => {
    const text = [
      '<aRacer ECU_Memory Log Data for RaceAMP>',
      'Created Date:2025/4/20 下午 05:21:15',
      'Product ID = 0xA6',
      'Serial Number = X',
      'Stage_1,Stage_1',
      'Time,RPM/r',
      '31.25,1000',
      '62.5,2000',
    ].join('\n')
    const track = extractGpsTrack(parseLoga(text))
    expect(hasGps(track)).toBe(false)
  })
})

describe('cumulativeDistanceM', () => {
  it('accumulates monotonically with correct magnitude', () => {
    const n = 5
    const lat = new Float64Array(n) // all 0
    const lon = new Float64Array(n)
    const valid = new Uint8Array(n).fill(1)
    for (let i = 0; i < n; i++) lon[i] = i * 0.001 // ~111.2 m per step at equator

    const dist = cumulativeDistanceM(lat, lon, valid)
    expect(dist[0]).toBe(0)
    for (let i = 1; i < n; i++) expect(dist[i]).toBeGreaterThan(dist[i - 1])
    expect(dist[1]).toBeCloseTo(111.2, 0)
    expect(dist[4]).toBeCloseTo(444.8, 0)
  })
})

describe('lttb', () => {
  it('reduces to maxPoints, keeps endpoints, stays monotone in x', () => {
    const n = 1000
    const x = new Float64Array(n)
    const y = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      x[i] = i
      y[i] = Math.sin(i / 20)
    }
    const out = lttb(x, y, 100)
    expect(out.x.length).toBe(100)
    expect(out.x[0]).toBe(0)
    expect(out.x[99]).toBe(999)
    for (let i = 1; i < out.x.length; i++) expect(out.x[i]).toBeGreaterThan(out.x[i - 1])
  })

  it('returns input unchanged when below threshold', () => {
    const out = lttb([0, 1, 2], [0, 1, 2], 100)
    expect(out.x).toEqual([0, 1, 2])
  })
})

describe('timeSeconds', () => {
  it('is zero-based seconds from the Time channel', () => {
    const t = timeSeconds(parseLoga(loadFixture('super2.loga')))
    expect(t[0]).toBe(0)
    expect(t[1]).toBeGreaterThan(0)
    expect(t[1]).toBeCloseTo(0.0625, 4) // 62.5 ms sample interval
  })
})
