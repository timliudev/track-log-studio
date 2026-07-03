import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import {
  parsePersonalTrackOverlay,
  TrackSchemaError,
  type PersonalTrackOverlayV1,
} from '@/domain/tracks/schema'

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
 *
 * The persisted shape is {@link PersonalTrackOverlayV1}
 * (docs/CLOUD-TRACK-DESIGN.md §1.3) — this module re-exports it as
 * `CircuitSetup` for source-compat with existing callers; the two names refer
 * to the exact same type.
 */
export type CircuitSetup = PersonalTrackOverlayV1

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

/**
 * Fetch the saved setup for `key`, or null if nothing is saved for it.
 * Tolerant of records written by the pre-v1 (un-versioned) code: they're
 * migrated in-memory via {@link parsePersonalTrackOverlay} on every read, so
 * existing users' saved setups keep working across the upgrade without a bulk
 * idb rewrite. A record that fails to parse (corrupted) is treated as absent
 * rather than throwing, so a single bad entry can't break restore-on-load.
 */
export async function getCircuitSetup(key: string): Promise<CircuitSetup | null> {
  const db = await getDb()
  const value = await db.get(STORE_NAME, key)
  if (value === undefined) return null
  try {
    return parsePersonalTrackOverlay(value)
  } catch {
    return null
  }
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

/**
 * List every saved circuit, most-recently-updated first. Same tolerant
 * migration as {@link getCircuitSetup}; a single corrupted/unparseable record
 * is skipped rather than failing the whole list.
 */
export async function listCircuitSetups(): Promise<CircuitSetup[]> {
  const db = await getDb()
  const all = await db.getAll(STORE_NAME)
  const parsed: CircuitSetup[] = []
  for (const value of all) {
    try {
      parsed.push(parsePersonalTrackOverlay(value))
    } catch {
      // Skip corrupted entries — see getCircuitSetup's tolerant-read note.
    }
  }
  return parsed.sort((a, b) => b.updatedAt - a.updatedAt)
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

/** Structural validation error for {@link importCircuitSetupJson}. Re-exported
 *  from the schema module so existing call sites (e.g. TrackFilePanel) that
 *  catch this specific class keep working unchanged. */
export const CircuitSetupImportError = TrackSchemaError

/**
 * Parse and structurally validate a JSON string as a {@link CircuitSetup}
 * (e.g. from a user-selected "本機軌跡檔" .json file). Tolerant of BOTH the
 * current versioned `PersonalTrackOverlayV1` shape and the pre-v1 un-versioned
 * shape (see {@link parsePersonalTrackOverlay}) — so a track file exported
 * before this upgrade still imports cleanly. Throws
 * {@link CircuitSetupImportError} with a human-readable reason on anything
 * malformed, so the UI can surface a clear message instead of silently
 * importing garbage.
 */
export function importCircuitSetupJson(text: string): CircuitSetup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new CircuitSetupImportError('Invalid JSON')
  }
  return parsePersonalTrackOverlay(raw)
}
