/**
 * RaceChrono `.rcz` DEVICE-BACKUP inspection (F3 stage 1).
 *
 * A plain `.rcz` (see `parseRcz.ts`) is a single-session export: channel files
 * and `session.json` sit at the ZIP ROOT. A RaceChrono APP BACKUP is a
 * different shape entirely — the same ZIP container instead holds MANY
 * sessions nested as `sessions/session_<ID>/…`, each with its own
 * `session.json` + `sessionfragment.json` + `channel_*` files. A real backup
 * is ~2 GB zipped / ~12 GB unzipped across ~700 sessions, so it must never be
 * inflated in one shot (`unzipSync(bytes)` with no filter would decompress
 * every channel blob of every session — an instant OOM in a browser tab).
 *
 * The non-OOM mechanism used throughout this module is fflate's
 * `unzipSync(data, { filter })`: internally it walks the ZIP CENTRAL
 * DIRECTORY (name/size metadata for every entry, cheap) and calls `filter`
 * once per entry BEFORE touching the entry's compressed bytes — entries whose
 * filter returns false are never read or inflated at all (see fflate's
 * `unzipSync` source: the local-file read + `inflateSync` call sit inside the
 * `if (filter(...))` branch). So `unzipSync(bytes, { filter })` on the full
 * (already in-memory) backup buffer is safe as long as the filter only
 * accepts the tiny handful of entries actually needed — it never inflates the
 * multi-megabyte `channel_*` blobs for sessions/files we don't ask for.
 *
 * `listRczSessions` uses this to inflate ONLY every `session.json` +
 * `sessionfragment.json` (a few hundred bytes each) — never a `channel_*`
 * file — regardless of how many sessions or how large their channel data is.
 * `parseRczBackupSession` (parseRczBackup.ts) uses the same mechanism to load
 * exactly one chosen session's files.
 */
import { unzipSync } from 'fflate'

/** Matches a session-scoped metadata file inside `sessions/<key>/…`. */
const SESSION_META_RE = /^sessions\/([^/]+)\/(session|sessionfragment)\.json$/

/** One `sessions/<key>/…` metadata-file match. */
export interface SessionMetaMatch {
  key: string
  kind: 'session' | 'sessionfragment'
}

/**
 * The exact predicate used as `unzipSync`'s `filter` for both {@link isRczBackup}
 * and {@link listRczSessions}: matches ONLY `sessions/<key>/session.json` and
 * `sessions/<key>/sessionfragment.json` — never a `channel_*` file, and never
 * a ROOT `session.json` (that shape is a single-session export, not a
 * backup). Exported standalone so the "what gets inflated" contract is
 * directly unit-testable without needing a real (multi-megabyte) archive.
 */
export function matchSessionMetaEntry(name: string): SessionMetaMatch | null {
  const m = name.match(SESSION_META_RE)
  if (!m) return null
  return { key: m[1], kind: m[2] as 'session' | 'sessionfragment' }
}

/**
 * Value RaceChrono stores for `bestLaptime` when no lap has been completed
 * yet: the Int64 max (`9223372036854775807`). JSON round-trips it through a
 * float64, so the parsed number is not bit-exact — treat anything absurdly
 * large (no real lap is anywhere near this many milliseconds) as "unset".
 */
const BEST_LAPTIME_UNSET_THRESHOLD = 1e15

/** Minimal shape of a backup session's `session.json` that we consume. */
interface BackupSessionJson {
  timeCreated?: number
  firstTimestamp?: number
  latestTimestamp?: number
  lengthTime?: number
  lengthDistance?: number
  lapCount?: number
  bestLaptime?: number
  trackId?: number
}

/** Minimal shape of a backup session's `sessionfragment.json`. */
interface SessionFragmentJson {
  primaryGpsDeviceIndex?: number
  devices?: { items?: { id?: number; model?: string; type?: number }[] }
}

/** Summary of one nested session in an `.rcz` device backup, for a picker UI. */
export interface RczSessionInfo {
  /** The `<ID>` in `sessions/session_<ID>/…` — pass back to `parseRczBackupSession`. */
  key: string
  /** Session start time (Unix ms), from `timeCreated` (falls back to `firstTimestamp`). */
  date: Date | null
  /** Session duration in ms (`session.json`'s `lengthTime`), if present. */
  durationMs: number | undefined
  /** Session distance in km (`lengthDistance` is millimetres → /1e6), if present. */
  distanceKm: number | undefined
  /** Recorded lap count (`session.json`'s `lapCount`), if present. */
  lapCount: number | undefined
  /** Best lap time in ms, or null when unset (Int64-max sentinel) or absent. */
  bestLaptimeMs: number | null
  /** Number of devices listed in `sessionfragment.json` (GPS + any CAN/ECU). */
  deviceCount: number
  /** The device id whose `type === 1` (GPS) — undefined if none found. */
  gpsDeviceId: number | undefined
}

/**
 * True if `bytes` is a RaceChrono device BACKUP (many sessions nested under
 * `sessions/<key>/session.json`) rather than a single-session export (plain
 * `session.json` at the ZIP root). Never inflates anything — the filter
 * always returns false, so this only walks the cheap central-directory
 * metadata to check entry NAMES.
 */
export function isRczBackup(bytes: Uint8Array): boolean {
  let found = false
  unzipSync(bytes, {
    filter: (file) => {
      if (!found && matchSessionMetaEntry(file.name)) found = true
      return false
    },
  })
  return found
}

/** Parse one field as a finite number, else undefined. */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Enumerate every `sessions/session_<ID>` in an `.rcz` device backup with just
 * enough metadata to label it in a picker (date, duration, distance, lap
 * count, best lap, device count, GPS device id) — WITHOUT inflating any
 * `channel_*` file (see module doc). Returns `[]` for a non-backup `.rcz` or
 * an archive with no recognisable sessions.
 */
export function listRczSessions(bytes: Uint8Array): RczSessionInfo[] {
  const entries = unzipSync(bytes, {
    filter: (file) => matchSessionMetaEntry(file.name) !== null,
  })

  const perSession = new Map<string, { session?: BackupSessionJson; fragment?: SessionFragmentJson }>()
  for (const [name, data] of Object.entries(entries)) {
    const match = matchSessionMetaEntry(name)
    if (!match) continue
    const { key, kind } = match
    const entry = perSession.get(key) ?? {}
    try {
      const parsed = JSON.parse(new TextDecoder().decode(data))
      if (kind === 'session') entry.session = parsed as BackupSessionJson
      else entry.fragment = parsed as SessionFragmentJson
    } catch {
      // Malformed metadata for this session — skip that one file, keep going.
    }
    perSession.set(key, entry)
  }

  const infos: RczSessionInfo[] = []
  for (const [key, { session, fragment }] of perSession) {
    const s = session ?? {}
    const createdEpoch = num(s.timeCreated) ?? num(s.firstTimestamp)
    const date = createdEpoch !== undefined ? new Date(createdEpoch) : null

    const distanceKm = num(s.lengthDistance) !== undefined ? num(s.lengthDistance)! / 1_000_000 : undefined

    const rawBest = num(s.bestLaptime)
    const bestLaptimeMs =
      rawBest !== undefined && rawBest < BEST_LAPTIME_UNSET_THRESHOLD ? rawBest : null

    const devices = fragment?.devices?.items ?? []
    const gpsDevice = devices.find((d) => d.type === 1)

    infos.push({
      key,
      date,
      durationMs: num(s.lengthTime),
      distanceKm,
      lapCount: num(s.lapCount),
      bestLaptimeMs,
      deviceCount: devices.length,
      gpsDeviceId: gpsDevice?.id,
    })
  }

  // Stable, human-friendly order (folder keys are typically
  // `session_YYYYMMDD_HHMM`, so lexical order is also chronological).
  infos.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return infos
}
