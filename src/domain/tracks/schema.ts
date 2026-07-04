import type { LapLine } from '@/domain/analysis/laps'
import type { LapMetricColumn } from '@/stores/lapStore'

/**
 * Versioned track schema (docs/CLOUD-TRACK-DESIGN.md §1). Two shapes are
 * defined there: `TrackDefinitionV1` (SHARED, public track library — later
 * phase, not consumed anywhere yet) and `PersonalTrackOverlayV1` (PERSONAL,
 * this user's own idb-backed setup). This module only implements what Phase 1
 * of §7 needs: `PersonalTrackOverlayV1` plus validation/migration. The
 * `TrackDefinitionV1` shape is declared now (unused) so its fields are pinned
 * down for Phase 2 to consume without a second round of schema churn.
 */

/** A geographic point (lat/lon decimal degrees). Same shape as the endpoints
 *  already used by {@link LapLine}, named here per the design doc's §1.2 SHARED
 *  schema so Phase 2 code can import it directly. */
export interface GeoPoint {
  lat: number
  lon: number
}

/** Schema versions this app can currently read. Bump-and-append when a new
 *  version is introduced; see docs/CLOUD-TRACK-DESIGN.md §6. */
export const SUPPORTED_TRACK_SCHEMA_VERSIONS = [1] as const
export type SupportedTrackSchemaVersion = (typeof SUPPORTED_TRACK_SCHEMA_VERSIONS)[number]

/**
 * SHARED track definition (design doc §1.2) — the public track-library entry.
 * Not yet produced or consumed anywhere (no SHARED library exists until
 * Phase 2/3); declared here only so the field names are fixed in advance.
 */
export interface TrackDefinitionV1 {
  schemaVersion: 1
  id: string
  name: Record<string, string>
  aliases?: string[]
  geo: GeoPoint
  countryCode: string
  startFinishLine: { a: GeoPoint; b: GeoPoint }
  gates: { a: GeoPoint; b: GeoPoint }[]
  recommendedLapTimeBandSec?: { min?: number; max?: number }
  direction?: 'cw' | 'ccw'
  license: string
  updatedAt: string
  contributors?: string[]
}

function isGeoPointRange(v: unknown): v is { lat: number; lon: number } {
  if (!isLatLon(v)) return false
  return v.lat >= -90 && v.lat <= 90 && v.lon >= -180 && v.lon <= 180
}

function isGateEndpointPair(v: unknown): v is { a: GeoPoint; b: GeoPoint } {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return isGeoPointRange(o.a) && isGeoPointRange(o.b)
}

/**
 * Structural + range validation for a {@link TrackDefinitionV1} (design doc
 * §1.2/§2.3 CI schema check, reused client-side so a malformed SHARED-library
 * entry — corrupt bundle, bad CDN payload — can't crash matching for every
 * OTHER track in the library; see {@link parseTrackLibrary}, which uses this
 * per-entry so one bad record is skipped rather than failing the whole load).
 * Throws {@link TrackSchemaError} with a human-readable reason on anything
 * malformed.
 */
export function parseTrackDefinition(raw: unknown): TrackDefinitionV1 {
  if (typeof raw !== 'object' || raw === null) {
    throw new TrackSchemaError('Not an object')
  }
  const o = raw as Record<string, unknown>

  if (o.schemaVersion !== 1) {
    throw new TrackSchemaError(`Unsupported schemaVersion: ${String(o.schemaVersion)}`)
  }
  if (typeof o.id !== 'string' || o.id.length === 0) {
    throw new TrackSchemaError('Missing or invalid "id"')
  }
  if (typeof o.name !== 'object' || o.name === null || Array.isArray(o.name)) {
    throw new TrackSchemaError('Missing or invalid "name"')
  }
  const nameEntries = Object.entries(o.name as Record<string, unknown>)
  if (nameEntries.length === 0 || !nameEntries.every(([, v]) => typeof v === 'string')) {
    throw new TrackSchemaError('"name" must have at least one locale with a string value')
  }
  if (o.aliases !== undefined && (!Array.isArray(o.aliases) || !o.aliases.every((a) => typeof a === 'string'))) {
    throw new TrackSchemaError('Invalid "aliases"')
  }
  if (!isGeoPointRange(o.geo)) {
    throw new TrackSchemaError('Missing or invalid "geo"')
  }
  if (typeof o.countryCode !== 'string' || !/^[A-Z]{2}$/.test(o.countryCode)) {
    throw new TrackSchemaError('Invalid "countryCode" (expected ISO 3166-1 alpha-2, uppercase)')
  }
  if (!isGateEndpointPair(o.startFinishLine)) {
    throw new TrackSchemaError('Missing or invalid "startFinishLine"')
  }
  if (!Array.isArray(o.gates) || !o.gates.every(isGateEndpointPair)) {
    throw new TrackSchemaError('Invalid "gates"')
  }
  if (o.recommendedLapTimeBandSec !== undefined) {
    const band = o.recommendedLapTimeBandSec
    if (typeof band !== 'object' || band === null) {
      throw new TrackSchemaError('Invalid "recommendedLapTimeBandSec"')
    }
    const b = band as Record<string, unknown>
    if (b.min !== undefined && typeof b.min !== 'number') {
      throw new TrackSchemaError('Invalid "recommendedLapTimeBandSec.min"')
    }
    if (b.max !== undefined && typeof b.max !== 'number') {
      throw new TrackSchemaError('Invalid "recommendedLapTimeBandSec.max"')
    }
  }
  if (o.direction !== undefined && o.direction !== 'cw' && o.direction !== 'ccw') {
    throw new TrackSchemaError('Invalid "direction"')
  }
  if (typeof o.license !== 'string' || o.license.length === 0) {
    throw new TrackSchemaError('Missing or invalid "license"')
  }
  if (typeof o.updatedAt !== 'string' || o.updatedAt.length === 0) {
    throw new TrackSchemaError('Missing or invalid "updatedAt"')
  }
  if (
    o.contributors !== undefined &&
    (!Array.isArray(o.contributors) || !o.contributors.every((c) => typeof c === 'string'))
  ) {
    throw new TrackSchemaError('Invalid "contributors"')
  }

  return {
    schemaVersion: 1,
    id: o.id,
    name: o.name as Record<string, string>,
    aliases: o.aliases as string[] | undefined,
    geo: o.geo as GeoPoint,
    countryCode: o.countryCode,
    startFinishLine: o.startFinishLine as { a: GeoPoint; b: GeoPoint },
    gates: o.gates as { a: GeoPoint; b: GeoPoint }[],
    recommendedLapTimeBandSec: o.recommendedLapTimeBandSec as
      | { min?: number; max?: number }
      | undefined,
    direction: o.direction as 'cw' | 'ccw' | undefined,
    license: o.license,
    updatedAt: o.updatedAt,
    contributors: o.contributors as string[] | undefined,
  }
}

/**
 * Parse a whole SHARED track library (an array of raw entries — e.g. the
 * bundled seed snapshot, §3.2 step 1). Each entry is validated independently
 * via {@link parseTrackDefinition}; a single malformed entry is skipped (with
 * its reason available via the returned `errors` array) rather than failing
 * the whole library load — same "one bad record can't take down everything
 * else" principle as {@link listCircuitSetups}'s tolerant read.
 */
export function parseTrackLibrary(raw: unknown[]): {
  tracks: TrackDefinitionV1[]
  errors: string[]
} {
  const tracks: TrackDefinitionV1[] = []
  const errors: string[] = []
  for (const entry of raw) {
    try {
      tracks.push(parseTrackDefinition(entry))
    } catch (err) {
      const reason = err instanceof TrackSchemaError ? err.message : String(err)
      const id = typeof entry === 'object' && entry !== null && 'id' in entry ? String((entry as Record<string, unknown>).id) : '?'
      errors.push(`${id}: ${reason}`)
    }
  }
  return { tracks, errors }
}

/**
 * PERSONAL track overlay (design doc §1.3) — this user's own saved setup for
 * one circuit, keyed by {@link import('@/domain/persist/circuitKey').circuitKey}
 * (unchanged from the pre-v1 `CircuitSetup`; see that module's docs for why
 * `trackId` can't be the primary idb key).
 *
 * Phase 1 note: there is no SHARED track library yet (§7 第一階段), so
 * `trackId` is always `null` for now — every saved overlay is the "local
 * override" flavor. The field exists so Phase 2 can start writing a non-null
 * `trackId` without another migration.
 */
export interface PersonalTrackOverlayV1 {
  schemaVersion: 1

  /** Primary key: see `circuitKey()`. Kept on the record itself (not just as
   *  the idb keyPath) so export/import round-trips carry it in the JSON file
   *  the same way the pre-v1 `CircuitSetup.key` did. */
  key: string

  /** Which SHARED track (§1.2) this overlay is attached to, if any. Always
   *  `null` in Phase 1 — no SHARED library exists yet to match against. */
  trackId: string | null

  /** Local geometry. In Phase 1 (no SHARED library) this is the ONLY source of
   *  geometry, exactly like the pre-v1 `CircuitSetup.line`/`gates` — so it's
   *  always populated (not left undefined) whenever the user has drawn a
   *  line/gates, matching current behavior. Once Phase 2 introduces a SHARED
   *  track to fall back on, an overlay attached to one (`trackId !== null`)
   *  may leave this `undefined` to mean "follow the SHARED geometry", per
   *  §4.4 detach semantics. */
  localOverride?: {
    line: LapLine | null
    gates: LapLine[]
  }

  /** Lap-table column config — always personal, never part of a SHARED track
   *  (§1.2 exclusion table). */
  columns: LapMetricColumn[]

  /** User-editable display name, unchanged semantics from pre-v1. */
  name?: string

  /** epoch ms of last save. */
  updatedAt: number
}

/** Structural validation error, thrown by {@link parsePersonalTrackOverlay}. */
export class TrackSchemaError extends Error {}

function isLatLon(v: unknown): v is GeoPoint {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.lat === 'number' && typeof o.lon === 'number'
}

function isLapLine(v: unknown): v is LapLine {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return isLatLon(o.a) && isLatLon(o.b)
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

function isLocalOverride(v: unknown): v is { line: LapLine | null; gates: LapLine[] } {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (o.line !== null && !isLapLine(o.line)) return false
  return Array.isArray(o.gates) && o.gates.every(isLapLine)
}

/**
 * The pre-v1, un-versioned on-disk/idb shape (formerly `CircuitSetup`). Kept
 * here (not deleted) purely as the migration source type — see
 * {@link migrateLegacyCircuitSetup}.
 */
export interface LegacyCircuitSetup {
  key: string
  name?: string
  line: LapLine | null
  gates: LapLine[]
  columns: LapMetricColumn[]
  updatedAt: number
}

function isLegacyCircuitSetup(v: unknown): v is LegacyCircuitSetup {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.key !== 'string' || o.key.length === 0) return false
  if (o.name !== undefined && typeof o.name !== 'string') return false
  if (o.line !== null && !isLapLine(o.line)) return false
  if (!Array.isArray(o.gates) || !o.gates.every(isLapLine)) return false
  if (!Array.isArray(o.columns) || !o.columns.every(isColumn)) return false
  if (typeof o.updatedAt !== 'number') return false
  return true
}

/**
 * Migrate a pre-v1 `CircuitSetup` record into `PersonalTrackOverlayV1`
 * (design doc §7 第一階段 step 1: fold `line`/`gates` into `localOverride`,
 * `trackId` always `null` since no SHARED library exists yet). Pure data
 * reshaping, no behavior change — the restored line/gates/columns are
 * identical to what the legacy shape held.
 */
export function migrateLegacyCircuitSetup(legacy: LegacyCircuitSetup): PersonalTrackOverlayV1 {
  return {
    schemaVersion: 1,
    key: legacy.key,
    trackId: null,
    localOverride: { line: legacy.line, gates: legacy.gates },
    columns: legacy.columns,
    name: legacy.name,
    updatedAt: legacy.updatedAt,
  }
}

/**
 * Validate + (if needed) migrate an unknown value read back from idb or a
 * `.json` file into a current `PersonalTrackOverlayV1`. Tolerant of BOTH:
 *  - the current versioned shape (`schemaVersion: 1`), validated as-is;
 *  - the pre-v1 un-versioned shape (no `schemaVersion` field at all), which is
 *    migrated via {@link migrateLegacyCircuitSetup} — this is what makes
 *    existing users' saved setups survive the upgrade (§6, §7 驗收).
 *
 * Throws {@link TrackSchemaError} with a human-readable reason if `raw`
 * matches neither shape.
 */
export function parsePersonalTrackOverlay(raw: unknown): PersonalTrackOverlayV1 {
  if (typeof raw !== 'object' || raw === null) {
    throw new TrackSchemaError('Not an object')
  }
  const o = raw as Record<string, unknown>

  // No schemaVersion at all => try the legacy (pre-v1) shape.
  if (o.schemaVersion === undefined) {
    if (!isLegacyCircuitSetup(raw)) {
      throw new TrackSchemaError('Missing or invalid "key"/"line"/"gates"/"columns"/"updatedAt"')
    }
    return migrateLegacyCircuitSetup(raw)
  }

  if (!SUPPORTED_TRACK_SCHEMA_VERSIONS.includes(o.schemaVersion as SupportedTrackSchemaVersion)) {
    throw new TrackSchemaError(`Unsupported schemaVersion: ${String(o.schemaVersion)}`)
  }

  if (typeof o.key !== 'string' || o.key.length === 0) {
    throw new TrackSchemaError('Missing or invalid "key"')
  }
  if (o.trackId !== undefined && o.trackId !== null && typeof o.trackId !== 'string') {
    throw new TrackSchemaError('Invalid "trackId"')
  }
  if (o.name !== undefined && typeof o.name !== 'string') {
    throw new TrackSchemaError('Invalid "name"')
  }
  if (o.localOverride !== undefined && !isLocalOverride(o.localOverride)) {
    throw new TrackSchemaError('Invalid "localOverride"')
  }
  if (!Array.isArray(o.columns) || !o.columns.every(isColumn)) {
    throw new TrackSchemaError('Invalid "columns"')
  }
  if (typeof o.updatedAt !== 'number') {
    throw new TrackSchemaError('Invalid "updatedAt"')
  }

  return {
    schemaVersion: 1,
    key: o.key,
    trackId: (o.trackId as string | null) ?? null,
    localOverride: o.localOverride as { line: LapLine | null; gates: LapLine[] } | undefined,
    columns: o.columns as LapMetricColumn[],
    name: o.name as string | undefined,
    updatedAt: o.updatedAt,
  }
}

/**
 * Resolve which geometry (if any) `useCircuitPersistence`'s auto-apply should
 * use for a given saved overlay, per docs/CLOUD-TRACK-DESIGN.md §4.2's
 * matching/precedence flow — scoped to what exists in Phase 1 (§7 第一階段):
 *
 *  - flow ① (local `PersonalTrackOverlay` hit, highest precedence): if
 *    `overlay` is non-null and carries `localOverride`, that geometry wins,
 *    full stop — a personal setup is never second-guessed by anything else.
 *  - flow ② (SHARED library lookup): does not exist yet in Phase 1 — there is
 *    no library to fall back to when `overlay` has a `trackId` but no
 *    `localOverride`, so that case currently resolves to "nothing to apply"
 *    too (Phase 2 will extend this function to look the `trackId` up in a
 *    SHARED store instead).
 *  - flow ③ (no match at all): `overlay` is null → nothing to apply, caller
 *    leaves existing state alone (today: the auto-seeded default line).
 *
 * Pure and store-agnostic on purpose — `useCircuitPersistence.ts` calls this
 * with whatever `getCircuitSetup()` returned, then applies the result via the
 * usual store actions (`setLine`/`loadDetected`). Kept separate from that
 * composable so the precedence decision itself is unit-testable without Vue
 * reactivity or idb.
 */
export function resolveGeometryToApply(
  overlay: PersonalTrackOverlayV1 | null,
): { line: LapLine | null; gates: LapLine[] } | null {
  if (!overlay) return null
  return overlay.localOverride ?? null
}
