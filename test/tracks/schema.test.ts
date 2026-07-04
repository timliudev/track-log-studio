import { describe, it, expect } from 'vitest'
import {
  parsePersonalTrackOverlay,
  parseTrackDefinition,
  parseTrackLibrary,
  migrateLegacyCircuitSetup,
  resolveGeometryToApply,
  TrackSchemaError,
  SUPPORTED_TRACK_SCHEMA_VERSIONS,
  type LegacyCircuitSetup,
  type PersonalTrackOverlayV1,
  type TrackDefinitionV1,
} from '@/domain/tracks/schema'
import type { LapLine } from '@/domain/analysis/laps'

function line(n: number): LapLine {
  return { a: { lat: n, lon: n + 1 }, b: { lat: n + 2, lon: n + 3 } }
}

function trackDefinition(): TrackDefinitionV1 {
  return {
    schemaVersion: 1,
    id: 'tw-example-track',
    name: { 'zh-TW': '範例賽道', en: 'Example Track' },
    aliases: ['example'],
    geo: { lat: 23.5, lon: 120.5 },
    countryCode: 'TW',
    startFinishLine: { a: { lat: 23.5001, lon: 120.5 }, b: { lat: 23.4999, lon: 120.5 } },
    gates: [{ a: { lat: 23.501, lon: 120.502 }, b: { lat: 23.499, lon: 120.502 } }],
    recommendedLapTimeBandSec: { min: 40, max: 90 },
    direction: 'cw',
    license: 'CC0-1.0',
    updatedAt: '2026-07-05',
    contributors: ['someone'],
  }
}

function v1Overlay(): PersonalTrackOverlayV1 {
  return {
    schemaVersion: 1,
    key: '24.123,121.456',
    trackId: null,
    name: 'Chiayi Speedway',
    localOverride: { line: line(0), gates: [line(1), line(2)] },
    columns: [{ id: 1, metric: { kind: 'lapTime' } }],
    updatedAt: 1_700_000_000_000,
  }
}

function legacySetup(): LegacyCircuitSetup {
  return {
    key: '24.123,121.456',
    name: 'Chiayi Speedway',
    line: line(0),
    gates: [line(1), line(2)],
    columns: [{ id: 1, metric: { kind: 'lapTime' } }],
    updatedAt: 1_700_000_000_000,
  }
}

describe('SUPPORTED_TRACK_SCHEMA_VERSIONS', () => {
  it('currently only supports version 1', () => {
    expect(SUPPORTED_TRACK_SCHEMA_VERSIONS).toEqual([1])
  })
})

describe('parsePersonalTrackOverlay — validation (current v1 shape)', () => {
  it('accepts a fully-populated v1 overlay unchanged', () => {
    const overlay = v1Overlay()
    expect(parsePersonalTrackOverlay(overlay)).toEqual(overlay)
  })

  it('accepts an overlay with no localOverride (future SHARED-track-attached case)', () => {
    const overlay: PersonalTrackOverlayV1 = {
      schemaVersion: 1,
      key: '1.000,2.000',
      trackId: 'tw-chiayi-speedway',
      columns: [],
      updatedAt: 0,
    }
    expect(parsePersonalTrackOverlay(overlay)).toEqual(overlay)
  })

  it('defaults a missing trackId to null', () => {
    const { trackId, ...rest } = v1Overlay()
    void trackId
    const parsed = parsePersonalTrackOverlay(rest)
    expect(parsed.trackId).toBeNull()
  })

  it('rejects a non-object', () => {
    expect(() => parsePersonalTrackOverlay(null)).toThrow(TrackSchemaError)
    expect(() => parsePersonalTrackOverlay('nope')).toThrow(TrackSchemaError)
    expect(() => parsePersonalTrackOverlay(42)).toThrow(TrackSchemaError)
  })

  it('rejects an unsupported schemaVersion', () => {
    const bad = { ...v1Overlay(), schemaVersion: 2 }
    expect(() => parsePersonalTrackOverlay(bad)).toThrow(TrackSchemaError)
  })

  it('rejects a missing key', () => {
    const { key, ...rest } = v1Overlay()
    void key
    expect(() => parsePersonalTrackOverlay(rest)).toThrow(TrackSchemaError)
  })

  it('rejects a non-string, non-null trackId', () => {
    const bad = { ...v1Overlay(), trackId: 42 }
    expect(() => parsePersonalTrackOverlay(bad)).toThrow(TrackSchemaError)
  })

  it('rejects a malformed localOverride', () => {
    const bad = { ...v1Overlay(), localOverride: { line: { a: { lat: 1 } }, gates: [] } }
    expect(() => parsePersonalTrackOverlay(bad)).toThrow(TrackSchemaError)
  })

  it('rejects columns that fail structural validation', () => {
    const bad = { ...v1Overlay(), columns: [{ id: 'x', metric: { kind: 'lapTime' } }] }
    expect(() => parsePersonalTrackOverlay(bad)).toThrow(TrackSchemaError)
  })

  it('rejects a non-numeric updatedAt', () => {
    const bad = { ...v1Overlay(), updatedAt: 'yesterday' }
    expect(() => parsePersonalTrackOverlay(bad)).toThrow(TrackSchemaError)
  })
})

describe('migrateLegacyCircuitSetup', () => {
  it('folds line/gates into localOverride and sets trackId to null', () => {
    const legacy = legacySetup()
    const migrated = migrateLegacyCircuitSetup(legacy)
    expect(migrated).toEqual({
      schemaVersion: 1,
      key: legacy.key,
      trackId: null,
      name: legacy.name,
      localOverride: { line: legacy.line, gates: legacy.gates },
      columns: legacy.columns,
      updatedAt: legacy.updatedAt,
    })
  })

  it('preserves a null line and empty gates', () => {
    const legacy: LegacyCircuitSetup = {
      key: '1.000,2.000',
      line: null,
      gates: [],
      columns: [],
      updatedAt: 0,
    }
    const migrated = migrateLegacyCircuitSetup(legacy)
    expect(migrated.localOverride).toEqual({ line: null, gates: [] })
    expect(migrated.trackId).toBeNull()
  })
})

describe('parsePersonalTrackOverlay — tolerant read of legacy (un-versioned) data', () => {
  it('migrates a legacy record on read (no schemaVersion field present)', () => {
    const legacy = legacySetup()
    const parsed = parsePersonalTrackOverlay(legacy)
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.trackId).toBeNull()
    expect(parsed.localOverride).toEqual({ line: legacy.line, gates: legacy.gates })
    expect(parsed.columns).toEqual(legacy.columns)
    expect(parsed.name).toBe(legacy.name)
    expect(parsed.updatedAt).toBe(legacy.updatedAt)
  })

  it('rejects a legacy record that also fails structural validation', () => {
    const bad = { ...legacySetup(), gates: 'not-an-array' }
    expect(() => parsePersonalTrackOverlay(bad)).toThrow(TrackSchemaError)
  })

  it('rejects a legacy record missing "columns"', () => {
    const { columns, ...rest } = legacySetup()
    void columns
    expect(() => parsePersonalTrackOverlay(rest)).toThrow(TrackSchemaError)
  })
})

describe('resolveGeometryToApply — §4.2 matching/precedence, Phase-1-scoped', () => {
  it('flow ③: no saved overlay at all → nothing to apply', () => {
    expect(resolveGeometryToApply(null)).toBeNull()
  })

  it('flow ①: a saved overlay with localOverride → that geometry wins, always', () => {
    const overlay = v1Overlay()
    expect(resolveGeometryToApply(overlay)).toEqual(overlay.localOverride)
  })

  it('flow ①: localOverride with a null line and empty gates still resolves (not treated as "no match")', () => {
    const overlay: PersonalTrackOverlayV1 = {
      schemaVersion: 1,
      key: '1.000,2.000',
      trackId: null,
      localOverride: { line: null, gates: [] },
      columns: [],
      updatedAt: 0,
    }
    expect(resolveGeometryToApply(overlay)).toEqual({ line: null, gates: [] })
  })

  it('an overlay attached to a trackId but with no localOverride resolves to null in Phase 1 (no SHARED library to fall back to yet)', () => {
    const overlay: PersonalTrackOverlayV1 = {
      schemaVersion: 1,
      key: '1.000,2.000',
      trackId: 'tw-chiayi-speedway',
      columns: [],
      updatedAt: 0,
    }
    expect(resolveGeometryToApply(overlay)).toBeNull()
  })

  it('a migrated legacy overlay resolves to its original line/gates (precedence survives migration)', () => {
    const legacy = legacySetup()
    const migrated = migrateLegacyCircuitSetup(legacy)
    expect(resolveGeometryToApply(migrated)).toEqual({ line: legacy.line, gates: legacy.gates })
  })
})

describe('parseTrackDefinition (SHARED track, §1.2/§2.3)', () => {
  it('accepts a fully-populated definition unchanged', () => {
    const def = trackDefinition()
    expect(parseTrackDefinition(def)).toEqual(def)
  })

  it('accepts a minimal definition without optional fields', () => {
    const def = trackDefinition()
    delete (def as Partial<TrackDefinitionV1>).aliases
    delete def.recommendedLapTimeBandSec
    delete def.direction
    delete def.contributors
    const parsed = parseTrackDefinition(def)
    expect(parsed.aliases).toBeUndefined()
    expect(parsed.recommendedLapTimeBandSec).toBeUndefined()
    expect(parsed.direction).toBeUndefined()
    expect(parsed.contributors).toBeUndefined()
  })

  it('rejects a non-object', () => {
    expect(() => parseTrackDefinition(null)).toThrow(TrackSchemaError)
    expect(() => parseTrackDefinition('nope')).toThrow(TrackSchemaError)
  })

  it('rejects a non-1 schemaVersion', () => {
    expect(() => parseTrackDefinition({ ...trackDefinition(), schemaVersion: 2 })).toThrow(TrackSchemaError)
  })

  it('rejects a missing id', () => {
    const { id, ...rest } = trackDefinition()
    void id
    expect(() => parseTrackDefinition(rest)).toThrow(TrackSchemaError)
  })

  it('rejects a name with no locales', () => {
    expect(() => parseTrackDefinition({ ...trackDefinition(), name: {} })).toThrow(TrackSchemaError)
  })

  it('rejects a name with a non-string value', () => {
    expect(() => parseTrackDefinition({ ...trackDefinition(), name: { en: 42 } })).toThrow(TrackSchemaError)
  })

  it('rejects invalid aliases', () => {
    expect(() => parseTrackDefinition({ ...trackDefinition(), aliases: [42] })).toThrow(TrackSchemaError)
  })

  it('rejects an out-of-range geo', () => {
    expect(() => parseTrackDefinition({ ...trackDefinition(), geo: { lat: 999, lon: 0 } })).toThrow(
      TrackSchemaError,
    )
    expect(() => parseTrackDefinition({ ...trackDefinition(), geo: { lat: 0, lon: -200 } })).toThrow(
      TrackSchemaError,
    )
  })

  it('rejects a lowercase or malformed countryCode', () => {
    expect(() => parseTrackDefinition({ ...trackDefinition(), countryCode: 'tw' })).toThrow(TrackSchemaError)
    expect(() => parseTrackDefinition({ ...trackDefinition(), countryCode: 'TWN' })).toThrow(TrackSchemaError)
  })

  it('rejects a malformed startFinishLine', () => {
    expect(() =>
      parseTrackDefinition({ ...trackDefinition(), startFinishLine: { a: { lat: 1 } } }),
    ).toThrow(TrackSchemaError)
  })

  it('rejects gates that are not an array of endpoint pairs', () => {
    expect(() => parseTrackDefinition({ ...trackDefinition(), gates: 'nope' })).toThrow(TrackSchemaError)
    expect(() => parseTrackDefinition({ ...trackDefinition(), gates: [{ a: { lat: 1 } }] })).toThrow(
      TrackSchemaError,
    )
  })

  it('rejects an invalid recommendedLapTimeBandSec', () => {
    expect(() =>
      parseTrackDefinition({ ...trackDefinition(), recommendedLapTimeBandSec: { min: 'x' } }),
    ).toThrow(TrackSchemaError)
  })

  it('rejects an invalid direction', () => {
    expect(() => parseTrackDefinition({ ...trackDefinition(), direction: 'sideways' })).toThrow(
      TrackSchemaError,
    )
  })

  it('rejects a missing license', () => {
    const { license, ...rest } = trackDefinition()
    void license
    expect(() => parseTrackDefinition(rest)).toThrow(TrackSchemaError)
  })

  it('rejects a missing updatedAt', () => {
    const { updatedAt, ...rest } = trackDefinition()
    void updatedAt
    expect(() => parseTrackDefinition(rest)).toThrow(TrackSchemaError)
  })

  it('rejects invalid contributors', () => {
    expect(() => parseTrackDefinition({ ...trackDefinition(), contributors: [42] })).toThrow(TrackSchemaError)
  })
})

describe('parseTrackLibrary (§2.3 CI-style validation, one-bad-entry-tolerant)', () => {
  it('parses every entry when all are valid', () => {
    const { tracks, errors } = parseTrackLibrary([trackDefinition(), { ...trackDefinition(), id: 'tw-two' }])
    expect(tracks).toHaveLength(2)
    expect(errors).toHaveLength(0)
  })

  it('skips a malformed entry and reports it, keeping the valid ones', () => {
    const bad = { ...trackDefinition(), id: 'tw-bad', license: undefined }
    const { tracks, errors } = parseTrackLibrary([trackDefinition(), bad])
    expect(tracks).toHaveLength(1)
    expect(tracks[0].id).toBe('tw-example-track')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('tw-bad')
  })

  it('returns an empty result for an empty input', () => {
    const { tracks, errors } = parseTrackLibrary([])
    expect(tracks).toEqual([])
    expect(errors).toEqual([])
  })
})
