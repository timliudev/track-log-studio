import { describe, it, expect } from 'vitest'
import {
  exportCircuitSetupJson,
  importCircuitSetupJson,
  CircuitSetupImportError,
  type CircuitSetup,
} from '@/domain/persist/circuitStore'
import type { LapLine } from '@/domain/analysis/laps'

function line(n: number): LapLine {
  return { a: { lat: n, lon: n + 1 }, b: { lat: n + 2, lon: n + 3 } }
}

function fullSetup(): CircuitSetup {
  return {
    key: '24.123,121.456',
    name: 'Chiayi Speedway',
    line: line(0),
    gates: [line(1), line(2), line(3)],
    columns: [
      { id: 1, metric: { kind: 'lapTime' } },
      { id: 2, metric: { kind: 'distance' } },
      { id: 3, metric: { kind: 'channel', channel: 'GPS_Speed', agg: 'max' } },
    ],
    updatedAt: 1_700_000_000_000,
  }
}

describe('exportCircuitSetupJson / importCircuitSetupJson', () => {
  it('round-trips a full setup (line + gates + columns) byte-for-byte on the fields', () => {
    const setup = fullSetup()
    const json = exportCircuitSetupJson(setup)
    const parsed = importCircuitSetupJson(json)
    expect(parsed).toEqual(setup)
  })

  it('round-trips a setup with a null line and empty gates/columns', () => {
    const setup: CircuitSetup = {
      key: '1.000,2.000',
      line: null,
      gates: [],
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

  it('rejects a malformed line (missing endpoint)', () => {
    const bad = { ...fullSetup(), line: { a: { lat: 1, lon: 2 } } }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('rejects a malformed line (non-numeric lat/lon)', () => {
    const bad = { ...fullSetup(), line: { a: { lat: '1', lon: 2 }, b: { lat: 3, lon: 4 } } }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('rejects gates that are not an array', () => {
    const bad = { ...fullSetup(), gates: 'nope' }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })

  it('rejects a gate entry that is not a valid LapLine', () => {
    const bad = { ...fullSetup(), gates: [line(0), { a: { lat: 1 } }] }
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

  it('rejects a non-numeric updatedAt', () => {
    const bad = { ...fullSetup(), updatedAt: 'yesterday' }
    expect(() => importCircuitSetupJson(JSON.stringify(bad))).toThrow(CircuitSetupImportError)
  })
})
