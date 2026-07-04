import { describe, it, expect } from 'vitest'
import {
  findMatchingTracks,
  trackDefinitionGeometry,
  resolveMatch,
} from '@/domain/tracks/matching'
import type { PersonalTrackOverlayV1, TrackDefinitionV1 } from '@/domain/tracks/schema'
import type { LapLine } from '@/domain/analysis/laps'

function track(overrides: Partial<TrackDefinitionV1> = {}): TrackDefinitionV1 {
  return {
    schemaVersion: 1,
    id: 'tw-example-track',
    name: { en: 'Example Track' },
    geo: { lat: 23.5, lon: 120.5 },
    countryCode: 'TW',
    startFinishLine: { a: { lat: 23.5001, lon: 120.5 }, b: { lat: 23.4999, lon: 120.5 } },
    gates: [{ a: { lat: 23.501, lon: 120.502 }, b: { lat: 23.499, lon: 120.502 } }],
    license: 'CC0-1.0',
    updatedAt: '2026-07-05',
    ...overrides,
  }
}

function line(n: number): LapLine {
  return { a: { lat: n, lon: n + 1 }, b: { lat: n + 2, lon: n + 3 } }
}

describe('trackDefinitionGeometry', () => {
  it('reduces a TrackDefinitionV1 to { line, gates } in gate order (already sorted, no re-sort)', () => {
    const t = track()
    expect(trackDefinitionGeometry(t)).toEqual({
      line: t.startFinishLine,
      gates: t.gates,
    })
  })
})

describe('findMatchingTracks (§4.2 flow ②, §4.1 tolerance reuse)', () => {
  it('returns an empty array when no track is nearby', () => {
    const library = [track({ geo: { lat: 1, lon: 1 } })]
    expect(findMatchingTracks('23.500,120.500', library)).toEqual([])
  })

  it('matches a track whose geo is exactly the candidate key', () => {
    const t = track({ geo: { lat: 23.5, lon: 120.5 } })
    expect(findMatchingTracks('23.500,120.500', [t])).toEqual([t])
  })

  it('matches within the ~100m circuitKeysMatch tolerance', () => {
    const t = track({ geo: { lat: 23.5005, lon: 120.5 } })
    expect(findMatchingTracks('23.500,120.500', [t])).toEqual([t])
  })

  it('does not match beyond tolerance', () => {
    const t = track({ geo: { lat: 23.6, lon: 120.5 } })
    expect(findMatchingTracks('23.500,120.500', [t])).toEqual([])
  })

  it('returns multiple matches for the same-venue multi-layout case (§4.3)', () => {
    const a = track({ id: 'tw-a', geo: { lat: 23.5, lon: 120.5 } })
    const b = track({ id: 'tw-b', geo: { lat: 23.5, lon: 120.5 } })
    const unrelated = track({ id: 'tw-c', geo: { lat: 10, lon: 10 } })
    expect(findMatchingTracks('23.500,120.500', [a, b, unrelated])).toEqual([a, b])
  })
})

describe('resolveMatch (§4.2 full flow ①→②→③)', () => {
  const library = [track()]

  it('flow ①: a localOverride always wins, even with an unrelated trackId', () => {
    const overlay: PersonalTrackOverlayV1 = {
      schemaVersion: 1,
      key: '1.000,2.000',
      trackId: 'tw-example-track',
      localOverride: { line: line(0), gates: [line(1)] },
      columns: [],
      updatedAt: 0,
    }
    const result = resolveMatch('1.000,2.000', overlay, library)
    expect(result).toEqual({ kind: 'localOverride', geometry: overlay.localOverride })
  })

  it('flow ①: overlay with trackId but no localOverride re-applies the current SHARED geometry', () => {
    const overlay: PersonalTrackOverlayV1 = {
      schemaVersion: 1,
      key: '23.500,120.500',
      trackId: 'tw-example-track',
      columns: [],
      updatedAt: 0,
    }
    const result = resolveMatch('23.500,120.500', overlay, library)
    expect(result).toEqual({
      kind: 'sharedTrack',
      track: library[0],
      geometry: trackDefinitionGeometry(library[0]),
    })
  })

  it('flow ①: a trackId that no longer exists in the library falls through to a fresh geo scan', () => {
    const overlay: PersonalTrackOverlayV1 = {
      schemaVersion: 1,
      key: '23.500,120.500',
      trackId: 'tw-deleted-track',
      columns: [],
      updatedAt: 0,
    }
    const result = resolveMatch('23.500,120.500', overlay, library)
    expect(result.kind).toBe('sharedTrack')
  })

  it('flow ②: no overlay at all, exactly one SHARED match → auto-apply', () => {
    const result = resolveMatch('23.500,120.500', null, library)
    expect(result).toEqual({
      kind: 'sharedTrack',
      track: library[0],
      geometry: trackDefinitionGeometry(library[0]),
    })
  })

  it('flow ②: multiple SHARED matches → ambiguous, no auto-pick', () => {
    const a = track({ id: 'tw-a' })
    const b = track({ id: 'tw-b' })
    const result = resolveMatch('23.500,120.500', null, [a, b])
    expect(result).toEqual({ kind: 'ambiguous', candidates: [a, b] })
  })

  it('flow ③: no overlay, no SHARED match → none', () => {
    const result = resolveMatch('1.000,2.000', null, library)
    expect(result).toEqual({ kind: 'none' })
  })

  it('an overlay with neither localOverride nor trackId falls through to the geo scan', () => {
    const overlay: PersonalTrackOverlayV1 = {
      schemaVersion: 1,
      key: '23.500,120.500',
      trackId: null,
      columns: [],
      updatedAt: 0,
    }
    const result = resolveMatch('23.500,120.500', overlay, library)
    expect(result.kind).toBe('sharedTrack')
  })
})
