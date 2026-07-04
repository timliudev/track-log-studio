import { describe, it, expect } from 'vitest'
import {
  parsePersonalTrackOverlay,
  migrateLegacyCircuitSetup,
  resolveGeometryToApply,
  TrackSchemaError,
  SUPPORTED_TRACK_SCHEMA_VERSIONS,
  type LegacyCircuitSetup,
  type PersonalTrackOverlayV1,
} from '@/domain/tracks/schema'
import type { LapLine } from '@/domain/analysis/laps'

function line(n: number): LapLine {
  return { a: { lat: n, lon: n + 1 }, b: { lat: n + 2, lon: n + 3 } }
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
