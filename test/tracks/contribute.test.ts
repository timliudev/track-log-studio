import { describe, it, expect, vi } from 'vitest'
import { buildTrackContributionDraft, type TrackContributionInput } from '@/domain/tracks/contribute'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LapLine } from '@/domain/analysis/laps'

function track(lats: number[], lons: number[], valid?: number[]): GpsTrack {
  return {
    lat: new Float64Array(lats),
    lon: new Float64Array(lons),
    valid: new Uint8Array(valid ?? lats.map(() => 1)),
  }
}

function line(n: number): LapLine {
  return { a: { lat: n, lon: n + 1 }, b: { lat: n + 2, lon: n + 3 } }
}

function input(overrides: Partial<TrackContributionInput> = {}): TrackContributionInput {
  return {
    id: 'tw-example-track',
    locale: 'en',
    name: 'Example Track',
    countryCode: 'tw',
    license: 'CC0-1.0',
    ...overrides,
  }
}

describe('buildTrackContributionDraft (§2.4 personal-setup → PR-ready TrackDefinitionV1)', () => {
  it('builds a full draft from a track, geometry and contributor metadata', () => {
    const t = track([23.0, 23.001, 23.002], [120.0, 120.001, 120.002])
    const geometry = { line: line(0), gates: [line(1), line(2)] }
    const draft = buildTrackContributionDraft(t, geometry, input())
    expect(draft).toEqual({
      schemaVersion: 1,
      id: 'tw-example-track',
      name: { en: 'Example Track' },
      geo: { lat: 23.001, lon: 120.001 },
      countryCode: 'TW',
      startFinishLine: line(0),
      gates: [line(1), line(2)],
      license: 'CC0-1.0',
      updatedAt: new Date().toISOString().slice(0, 10),
    })
  })

  it('uppercases a lowercase countryCode', () => {
    const t = track([23], [120])
    const draft = buildTrackContributionDraft(t, { line: line(0), gates: [] }, input({ countryCode: 'jp' }))
    expect(draft?.countryCode).toBe('JP')
  })

  it('returns null when the track has no valid GPS fix', () => {
    const t = track([23], [120], [0])
    const draft = buildTrackContributionDraft(t, { line: line(0), gates: [] }, input())
    expect(draft).toBeNull()
  })

  it('returns null when there is no start/finish line to export', () => {
    const t = track([23], [120])
    const draft = buildTrackContributionDraft(t, { line: null, gates: [] }, input())
    expect(draft).toBeNull()
  })

  it('supports an empty gates array (line-only track)', () => {
    const t = track([23], [120])
    const draft = buildTrackContributionDraft(t, { line: line(0), gates: [] }, input())
    expect(draft?.gates).toEqual([])
  })

  it('places the display name under the requested locale key', () => {
    const t = track([23], [120])
    const draft = buildTrackContributionDraft(
      t,
      { line: line(0), gates: [] },
      input({ locale: 'zh-TW', name: '範例賽道' }),
    )
    expect(draft?.name).toEqual({ 'zh-TW': '範例賽道' })
  })

  it("stamps updatedAt with today's date (ISO, date-only)", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-05T12:34:56Z'))
    const t = track([23], [120])
    const draft = buildTrackContributionDraft(t, { line: line(0), gates: [] }, input())
    expect(draft?.updatedAt).toBe('2026-07-05')
    vi.useRealTimers()
  })
})
