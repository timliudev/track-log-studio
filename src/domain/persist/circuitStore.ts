import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { LapLine } from '@/domain/analysis/laps'
import type { LapMetricColumn } from '@/stores/lapStore'

const DB_NAME = 'track-log-studio'
const DB_VERSION = 1
const STORE_NAME = 'circuits'

/**
 * A saved track setup for one circuit (start/finish line, confirmed sector
 * gates, and lap-table column config), keyed by {@link circuitKey}. This is
 * the ONLY thing DESIGN.md §11 D persists locally — per-recording state (lap
 * selection, manual exclusions, time band, alignment offsets) is intentionally
 * excluded: it's index-keyed into a specific recording and already reset on
 * file change (see `useLaps`), so persisting it here would be meaningless
 * (and wrong) across different recordings of the same circuit.
 */
export interface CircuitSetup {
  /** Primary key: see {@link circuitKey}. */
  key: string
  /** Optional user-friendly label (e.g. "Chiayi Speedway"), editable in the UI. */
  name?: string
  line: LapLine | null
  gates: LapLine[]
  columns: LapMetricColumn[]
  /** epoch ms of last save, for display/sorting in a "saved circuits" list. */
  updatedAt: number
}

interface CircuitDbSchema extends DBSchema {
  [STORE_NAME]: {
    key: string
    value: CircuitSetup
  }
}

let dbPromise: Promise<IDBPDatabase<CircuitDbSchema>> | null = null

/** Lazily open (once) and memoize the shared database connection. */
function getDb(): Promise<IDBPDatabase<CircuitDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<CircuitDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      },
    })
  }
  return dbPromise
}

/** Fetch the saved setup for `key`, or null if nothing is saved for it. */
export async function getCircuitSetup(key: string): Promise<CircuitSetup | null> {
  const db = await getDb()
  const value = await db.get(STORE_NAME, key)
  return value ?? null
}

/**
 * Deep-clone a setup into plain (structured-cloneable) data. Callers hand us
 * LIVE Pinia state (`lapStore.line`, `sectorStore.gates`, …) which are Vue
 * reactive Proxies — IndexedDB's structured clone REJECTS Proxies with
 * `DataCloneError`, and because auto-save fires as a fire-and-forget promise
 * the failure is silent (found live 2026-07-02: the auto-save watcher never
 * persisted anything). All CircuitSetup fields are JSON-safe by construction
 * (geo points, string/enum metrics, numbers), so a JSON round-trip is a
 * lossless way to strip every Proxy at any depth.
 */
export function toPlainSetup(setup: CircuitSetup): CircuitSetup {
  return JSON.parse(JSON.stringify(setup)) as CircuitSetup
}

/** Insert or overwrite the saved setup for `setup.key`. */
export async function putCircuitSetup(setup: CircuitSetup): Promise<void> {
  const db = await getDb()
  await db.put(STORE_NAME, toPlainSetup(setup))
}

/** List every saved circuit, most-recently-updated first. */
export async function listCircuitSetups(): Promise<CircuitSetup[]> {
  const db = await getDb()
  const all = await db.getAll(STORE_NAME)
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Delete the saved setup for `key`, if any. */
export async function deleteCircuitSetup(key: string): Promise<void> {
  const db = await getDb()
  await db.delete(STORE_NAME, key)
}

/** Serialize a setup to a pretty-printed JSON string for a "本機軌跡檔" download. */
export function exportCircuitSetupJson(setup: CircuitSetup): string {
  return JSON.stringify(setup, null, 2)
}

/** Structural validation error for {@link importCircuitSetupJson}. */
export class CircuitSetupImportError extends Error {}

function isLapLine(v: unknown): v is LapLine {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return isLatLon(o.a) && isLatLon(o.b)
}

function isLatLon(v: unknown): v is { lat: number; lon: number } {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.lat === 'number' && typeof o.lon === 'number'
}

function isLapMetric(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (o.kind === 'lapTime' || o.kind === 'distance' || o.kind === 'delta') return true
  if (o.kind === 'channel') {
    return typeof o.channel === 'string' && typeof o.agg === 'string'
  }
  if (o.kind === 'sectorTime') {
    return typeof o.sector === 'number'
  }
  return false
}

function isColumn(v: unknown): v is LapMetricColumn {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'number' && isLapMetric(o.metric)
}

/**
 * Parse and structurally validate a JSON string as a {@link CircuitSetup}
 * (e.g. from a user-selected "本機軌跡檔" .json file). Throws
 * {@link CircuitSetupImportError} with a human-readable reason on anything
 * malformed — bad JSON, missing/wrong-typed fields, or a `line`/gate that
 * isn't a well-formed pair of lat/lon endpoints — so the UI can surface a
 * clear message instead of silently importing garbage.
 */
export function importCircuitSetupJson(text: string): CircuitSetup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new CircuitSetupImportError('Invalid JSON')
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new CircuitSetupImportError('Not an object')
  }
  const o = raw as Record<string, unknown>

  if (typeof o.key !== 'string' || o.key.length === 0) {
    throw new CircuitSetupImportError('Missing or invalid "key"')
  }
  if (o.name !== undefined && typeof o.name !== 'string') {
    throw new CircuitSetupImportError('Invalid "name"')
  }
  if (o.line !== null && !isLapLine(o.line)) {
    throw new CircuitSetupImportError('Invalid "line"')
  }
  if (!Array.isArray(o.gates) || !o.gates.every(isLapLine)) {
    throw new CircuitSetupImportError('Invalid "gates"')
  }
  if (!Array.isArray(o.columns) || !o.columns.every(isColumn)) {
    throw new CircuitSetupImportError('Invalid "columns"')
  }
  if (typeof o.updatedAt !== 'number') {
    throw new CircuitSetupImportError('Invalid "updatedAt"')
  }

  return {
    key: o.key,
    name: o.name as string | undefined,
    line: o.line as LapLine | null,
    gates: o.gates as LapLine[],
    columns: o.columns as LapMetricColumn[],
    updatedAt: o.updatedAt,
  }
}
