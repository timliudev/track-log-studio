import { describe, it, expect } from 'vitest'
import {
  exportCircuitSetupJson,
  importCircuitSetupJson,
  CircuitSetupImportError,
  type CircuitSetup,
} from '@/domain/persist/circuitStore'
import type { LapLine } from '@/domain/analysis/laps'
import type { LegacyCircuitSetup } from '@/domain/tracks/schema'

function line(n: number): LapLine {
  return { a: { lat: n, lon: n + 1 }, b: { lat: n + 2, lon: n + 3 } }
}

function fullSetup(): CircuitSetup {
  return {
    schemaVersion: 1,
    key: '24.123,121.456',
    trackId: null,
    name: 'Chiayi Speedway',
    localOverride: { line: line(0), gates: [line(1), line(2), line(3)] },
    columns: [
      { id: 1, metric: { kind: 'lapTime' } },
      { id: 2, metric: { kind: 'distance' } },
      { id: 3, metric: { kind: 'channel', channel: 'GPS_Speed', agg: 'max' } },
      { id: 4, metric: { kind: 'sectorTime', sector: 1 } },
      { id: 5, metric: { kind: 'delta' } },
    ],
    updatedAt: 1_700_000_000_000,
  }
}

/** A pre-v1 (un-versioned) "track-as-file" JSON — what TrackFilePanel exported
 *  before this schema upgrade. Used to verify tolerant import (§6 migration). */
function legacyFullSetup(): LegacyCircuitSetup {
  return {
    key: '24.123,121.456',
    name: 'Chiayi Speedway',
    line: line(0),
    gates: [line(1), line(2), line(3)],
    columns: [
      { id: 1, metric: { kind: 'lapTime' } },
      { id: 2, metric: { kind: 'distance' } },
      { id: 3, metric: { kind: 'channel', channel: 'GPS_Speed', agg: 'max' } },
      { id: 4, metric: { kind: 'sectorTime', sector: 1 } },
      { id: 5, metric: { kind: 'delta' } },
    ],
    updatedAt: 1_700_000_000_000,
  }
}

describe('exportCircuitSetupJson / importCircuitSetupJson (current v1 shape)', () => {
  it('round-trips a full setup (localOverride + columns) byte-for-byte on the fields', () => {
    const setup = fullSetup()
    const json = exportCircuitSetupJson(setup)
    const parsed = importCircuitSetupJson(json)
    expect(parsed).toEqual(setup)
  })

  it('round-trips a setup with a null line and empty gates/columns', () => {
    const setup: CircuitSetup = {
      schemaVersion: 1,
      key: '1.000,2.000',
      trackId: null,
      localOverride: { line: null, gates: [] },
      columns: [],
      updatedAt: 0,
    }
    const parsed = importCircuitSetupJson(exportCircuitSetupJson(setup))
    expect(parsed).toEqual(setup)
  })

  it('round-trips without the optional name field', () => {
    const setup = { ...fullSetup(), name: undefined }
    delete setup.name
    const parsed = importCircuitSetupJson(exportCircuitSetupJson(setup))
    expect(parsed.name).toBeUndefined()
  })

  it('round-trips a non-null trackId (forward-compat with a future Phase-2 writer)', () => {
    const setup = { ...fullSetup(), trackId: 'tw-chiayi-speedway' }
    const parsed = importCircuitSetupJson(exportCircuitSetupJson(setup))
    expect(parsed.trackId).toBe('tw-chiayi-speedway')
  })

  it('rejects invalid JSON', () => {
    expect(() => importCircuitSetupJson('{not json')).toThrow(CircuitSetupImportError)
  })

  it('rejects a JSON array (not an object)', () => {
    expect(() => importCircuitSetupJson('[1,2,3]')).toThrow(CircuitSetupImportError)
  })

  it('rejects a missing key', () => {
    const { key, ...rest } = fullSetup()
    void key
    expect(() => importCircuitSetupJson(JSON.stringify(rest))).toThrow(CircuitSetupImportError)
  })

  it('rejects a non-string name', () => {
    const bad = { ...fullSetup(), name: 42 }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('rejects an unsupported schemaVersion', () => {
    const bad = { ...fullSetup(), schemaVersion: 99 }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('rejects a malformed localOverride (missing gate endpoint)', () => {
    const bad = {
      ...fullSetup(),
      localOverride: { line: { a: { lat: 1, lon: 2 } }, gates: [] },
    }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('rejects a malformed localOverride (non-numeric lat/lon)', () => {
    const bad = {
      ...fullSetup(),
      localOverride: {
        line: { a: { lat: '1', lon: 2 }, b: { lat: 3, lon: 4 } },
        gates: [],
      },
    }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('rejects columns that are not an array', () => {
    const bad = { ...fullSetup(), columns: {} }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('rejects a column with a non-numeric id', () => {
    const bad = { ...fullSetup(), columns: [{ id: '1', metric: { kind: 'lapTime' } }] }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('rejects a channel-kind column missing "channel" or "agg"', () => {
    const bad = {
      ...fullSetup(),
      columns: [{ id: 1, metric: { kind: 'channel', channel: 'GPS_Speed' } }],
    }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('rejects an unknown metric kind', () => {
    const bad = { ...fullSetup(), columns: [{ id: 1, metric: { kind: 'bogus' } }] }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('rejects a sectorTime-kind column missing "sector"', () => {
    const bad = { ...fullSetup(), columns: [{ id: 1, metric: { kind: 'sectorTime' } }] }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('rejects a non-numeric updatedAt', () => {
    const bad = { ...fullSetup(), updatedAt: 'yesterday' }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })
})

describe('importCircuitSetupJson (tolerant of pre-v1 legacy shape, docs/CLOUD-TRACK-DESIGN.md §6/§7)', () => {
  it('imports a legacy (un-versioned) full setup, migrating line/gates into localOverride', () => {
    const legacy = legacyFullSetup()
    const parsed = importCircuitSetupJson(JSON.stringify(legacy))
    expect(parsed).toEqual({
      schemaVersion: 1,
      key: legacy.key,
      trackId: null,
      name: legacy.name,
      localOverride: { line: legacy.line, gates: legacy.gates },
      columns: legacy.columns,
      updatedAt: legacy.updatedAt,
    })
  })

  it('imports a legacy setup with a null line and empty gates/columns', () => {
    const legacy: LegacyCircuitSetup = {
      key: '1.000,2.000',
      line: null,
      gates: [],
      columns: [],
      updatedAt: 0,
    }
    const parsed = importCircuitSetupJson(JSON.stringify(legacy))
    expect(parsed).toEqual({
      schemaVersion: 1,
      key: '1.000,2.000',
      trackId: null,
      localOverride: { line: null, gates: [] },
      columns: [],
      updatedAt: 0,
    })
  })

  it('still rejects a structurally invalid legacy setup (malformed gate)', () => {
    const bad = { ...legacyFullSetup(), gates: [line(0), { a: { lat: 1 } }] }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('still rejects a legacy setup missing "key"', () => {
    const { key, ...rest } = legacyFullSetup()
    void key
    expect(() => importCircuitSetupJson(JSON.stringify(rest))).toThrow(CircuitSetupImportError)
  })
})

describe('toPlainSetup (DataCloneError regression, 2026-07-02)', () => {
  it('strips Vue reactive proxies at every depth so IndexedDB structured clone accepts the value', async () => {
    const { reactive } = await import('vue')
    const { toPlainSetup } = await import('@/domain/persist/circuitStore')
    // Mirror the live failure: auto-save hands putCircuitSetup LIVE Pinia
    // state — reactive Proxies — which structuredClone (what IDB uses) rejects.
    const setup = {
      schemaVersion: 1 as const,
      key: 'k',
      trackId: null,
      localOverride: reactive({
        line: { a: { lat: 1, lon: 2 }, b: { lat: 3, lon: 4 } },
        gates: [{ a: { lat: 5, lon: 6 }, b: { lat: 7, lon: 8 } }],
      }),
      columns: reactive([{ id: 1, metric: { kind: 'lapTime' as const } }]),
      updatedAt: 123,
    }
    // Precondition: the raw reactive value really is un-cloneable (Proxy).
    expect(() => structuredClone(setup)).toThrow()
    const plain = toPlainSetup(setup as never)
    // The plain clone must be cloneable and value-identical.
    expect(() => structuredClone(plain)).not.toThrow()
    expect(plain).toEqual({
      schemaVersion: 1,
      key: 'k',
      trackId: null,
      localOverride: {
        line: { a: { lat: 1, lon: 2 }, b: { lat: 3, lon: 4 } },
        gates: [{ a: { lat: 5, lon: 6 }, b: { lat: 7, lon: 8 } }],
      },
      columns: [{ id: 1, metric: { kind: 'lapTime' } }],
      updatedAt: 123,
    })
  })

  it('captures a value snapshot that is unaffected by a later circuit-state change', async () => {
    const { reactive } = await import('vue')
    const { toPlainSetup } = await import('@/domain/persist/circuitStore')
    const live = reactive({
      schemaVersion: 1 as const,
      key: 'circuit-a',
      trackId: null,
      localOverride: {
        line: { a: { lat: 1, lon: 2 }, b: { lat: 3, lon: 4 } },
        gates: [{ a: { lat: 5, lon: 6 }, b: { lat: 7, lon: 8 } }],
      },
      columns: [],
      updatedAt: 123,
    })

    const scheduled = toPlainSetup(live)
    live.localOverride.gates[0].a.lat = 99

    expect(scheduled.key).toBe('circuit-a')
    expect(scheduled.localOverride?.line).toEqual({
      a: { lat: 1, lon: 2 },
      b: { lat: 3, lon: 4 },
    })
    expect(scheduled.localOverride?.gates[0].a.lat).toBe(5)
  })
})
