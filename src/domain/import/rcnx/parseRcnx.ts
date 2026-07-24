/**
 * Qstarz QRacing `.rcnx` importer (LT-Q6000 / Q6000S lap-timer GPS logger).
 *
 * An `.rcnx` is a ZIP container holding one or more "sessions"; each session is
 * three files (`N = 0, 1, 2, …`). Note: every ZIP entry name carries a trailing
 * NUL byte that must be stripped (`name.replace(/\0+$/, '')`).
 *
 *  - `sess_N.db`     — SQLite 3. Main GPS/telemetry track in table `WayPoints`.
 *  - `sana_N.db`     — SQLite 3. Derived lap/split analysis cache (`lap` table).
 *  - `summary_N.txt` — UTF-16LE text, alternating key-line / value-line.
 *
 * The pipeline returns ONE LogSession per parse call. By default we pick the
 * session with the most WayPoints (counted via `SELECT COUNT(*)` per
 * `sess_N.db`), same as before; callers that know which session they want
 * (from `listRcnxSessions`) can pass `sessionIndex` to override that choice —
 * this keeps existing single-session files byte-for-byte unchanged.
 *
 * `WayPoints` columns → canonical channels (units already correct, no scaling):
 *   time*1000 + ms − t0 → Time (ms, first = 0)
 *   lat → GPS_Lat (deg), lon → GPS_Lon (deg, E positive)
 *   speed → GPS_Speed (km/h), heading → GPS_Course (deg)
 *   altitude → GPS_Altitude (m), Gx/Gy/Gz (g), distance (km, cumulative).
 * There is no satellite-count column, so no Satellites channel.
 *
 * If the matching `sana_N.db` has a `lap` table (see docs/specs/RCNX-FORMAT-SPEC.md
 * §5), lap boundaries are exposed as an `IR_LapNumber`-style counter channel
 * (see `buildLapNumberChannel`) so the existing `detectLapsByChannel` path
 * (src/domain/analysis/laps.ts) picks them up with no analyzer changes.
 *
 * Unlike RCZ (pure-JS binary), the payload here is SQLite, which the browser
 * cannot read with node:sqlite — we use sql.js (SQLite compiled to WASM). In the
 * browser worker the caller passes `wasmLocateUrl` (the Vite-resolved wasm asset
 * URL); under node/vitest it is undefined and sql.js finds its own wasm.
 */
import { unzipSync } from 'fflate'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'
import type { Database, SqlJsStatic } from 'sql.js'

/** Strip the trailing NUL byte(s) Qstarz appends to every ZIP entry name. */
function stripNul(name: string): string {
  return name.replace(/\0+$/, '')
}

/**
 * Summary of one `sess_N` session within a `.rcnx` archive, enough to label it
 * in a "pick a session" UI without doing the full WayPoints/channel parse.
 */
export interface RcnxSessionInfo {
  /** The `N` in `sess_N.db` / `sana_N.db` / `summary_N.txt`. */
  n: number
  /** Row count of `sess_N.db`'s WayPoints table. */
  waypointCount: number
  /** Track short name from `summary_N.txt` (`sName`), if present. */
  trackName: string | undefined
  /** Session start time (Unix ms), from `summary_N.txt`'s `startTime`, if present. */
  startTimeMs: number | undefined
  /** Session duration in ms, derived from the first/last WayPoints row, if any. */
  durationMs: number | undefined
  /** True if a `sana_N.db` with a non-empty `lap` table was found for this session. */
  hasLapData: boolean
}

function readEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const rawEntries = unzipSync(bytes)
  const entries = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(rawEntries)) {
    entries.set(stripNul(name), data)
  }
  return entries
}

/** Parse a `summary_N.txt` (UTF-16LE) into a key→value map. */
function parseSummary(bytes: Uint8Array): Record<string, string> {
  const text = new TextDecoder('utf-16le').decode(bytes)
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\0+$/, '').trim())
    .filter((l) => l.length > 0)
  const map: Record<string, string> = {}
  for (let i = 0; i + 1 < lines.length; i += 2) {
    map[lines[i]] = lines[i + 1]
  }
  return map
}

/**
 * Enumerate every `sess_N` session in a `.rcnx` archive with just enough
 * metadata to label it in a picker (waypoint count, start time, duration,
 * track name, whether lap data exists). Does not build channels — cheap
 * enough to call before the user has chosen which session to open.
 */
export async function listRcnxSessions(
  bytes: Uint8Array,
  wasmLocateUrl?: string,
): Promise<RcnxSessionInfo[]> {
  const entries = readEntries(bytes)

  const sessionNs: number[] = []
  for (const name of entries.keys()) {
    const m = name.match(/^sess_(\d+)\.db$/)
    if (m) sessionNs.push(Number(m[1]))
  }
  sessionNs.sort((a, b) => a - b)
  if (sessionNs.length === 0) return []

  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs(
    wasmLocateUrl ? { locateFile: () => wasmLocateUrl } : undefined,
  )

  const infos: RcnxSessionInfo[] = []
  for (const n of sessionNs) {
    const sessBytes = entries.get(`sess_${n}.db`)
    if (!sessBytes) continue

    let waypointCount = 0
    let durationMs: number | undefined
    const db = new SQL.Database(sessBytes)
    try {
      const countRes = db.exec('SELECT COUNT(*) FROM WayPoints')
      waypointCount = Number(countRes[0]?.values?.[0]?.[0] ?? 0)

      if (waypointCount > 0) {
        const spanRes = db.exec(
          'SELECT (SELECT time * 1000 + ms FROM WayPoints ORDER BY id ASC LIMIT 1) AS t0, ' +
            '(SELECT time * 1000 + ms FROM WayPoints ORDER BY id DESC LIMIT 1) AS t1',
        )
        const row = spanRes[0]?.values?.[0]
        if (row) {
          const t0 = Number(row[0])
          const t1 = Number(row[1])
          if (Number.isFinite(t0) && Number.isFinite(t1)) durationMs = t1 - t0
        }
      }
    } finally {
      db.close()
    }

    let hasLapData = false
    const sanaBytes = entries.get(`sana_${n}.db`)
    if (sanaBytes) {
      const sanaDb = new SQL.Database(sanaBytes)
      try {
        const lapRes = sanaDb.exec('SELECT COUNT(*) FROM lap')
        hasLapData = Number(lapRes[0]?.values?.[0]?.[0] ?? 0) > 0
      } catch {
        hasLapData = false
      } finally {
        sanaDb.close()
      }
    }

    const summaryBytes = entries.get(`summary_${n}.txt`)
    const summary = summaryBytes ? parseSummary(summaryBytes) : {}
    const startTimeSec = Number(summary.startTime)
    const startTimeMs = Number.isFinite(startTimeSec) && startTimeSec > 0 ? startTimeSec * 1000 : undefined

    infos.push({
      n,
      waypointCount,
      trackName: summary.sName,
      startTimeMs,
      durationMs,
      hasLapData,
    })
  }
  return infos
}

/**
 * Read the `lap` table from a `sana_N.db` (may be absent — RCNX files without
 * a matching `sana_N.db`, or an unreadable/missing `lap` table, simply yield
 * no lap channel). Ordered by `id` (lap order); `bFailed` marks out/in-laps or
 * incomplete laps.
 */
interface SanaLap {
  startWp: number
  finishWp: number
  bFailed: boolean
}

function readSanaLaps(sanaBytes: Uint8Array | undefined, SQL: SqlJsStatic): SanaLap[] {
  if (!sanaBytes) return []
  let db: Database
  try {
    db = new SQL.Database(sanaBytes)
  } catch {
    return []
  }
  try {
    const res = db.exec('SELECT start_wp, finish_wp, bFailed FROM lap ORDER BY id ASC')
    if (res.length === 0) return []
    const { values } = res[0]
    return values.map((row) => ({
      startWp: Number(row[0]),
      finishWp: Number(row[1]),
      bFailed: Number(row[2]) !== 0,
    }))
  } catch {
    return []
  } finally {
    db.close()
  }
}

/**
 * Build an `IR_LapNumber`-style channel (one integer per WayPoints row,
 * incrementing at each lap's `finish_wp`) from the `sana_N.db` `lap` table, so
 * the existing `detectLapsByChannel` (src/domain/analysis/laps.ts) picks up
 * RCNX laps with no analyzer changes. `wpIdToRowIndex` maps `WayPoints.id` →
 * 0-based row index (ids are not guaranteed contiguous from 1).
 *
 * Rows before the first lap's `start_wp` are counted as lap 0 (pre-lap /
 * out-lap) — this mirrors how real ECU IR_LapNumber channels start at 0
 * before the first crossing, and matters functionally: `detectLapsByChannel`
 * only counts a boundary where the counter RISES from a previously-seen
 * value, so starting the very first lap's rows at 1 (rather than 0->1) would
 * make that first boundary invisible to the detector. Failed laps still
 * increment the counter (a boundary exists) but are not specially flagged
 * here — `detectLapsByChannel` has no failed-lap concept upstream.
 *
 * `detectLapsByChannel` forms a lap BETWEEN each pair of consecutive rising
 * edges of the counter, so N laps need N+1 crossings to be recovered: each
 * lap's `start_wp` (already an edge, since `lapNo` increments before it) AND
 * one more edge at the last lap's `finish_wp` to CLOSE it. Each `sana_N.db`
 * `lap` row is already a *complete* lap with its own `finish_wp` (unlike a
 * live ECU counter, which is still counting up mid-lap) — so the rows after
 * the last lap's `finish_wp` are NOT a continuation of that lap; they are a
 * separate, incomplete out-lap and must get their own (incremented) counter
 * value to produce the closing edge. Without this, the tail would silently
 * repeat the last lap's number, no closing edge would exist, and
 * `detectLapsByChannel` would drop the final lap entirely (N laps -> N-1
 * detected). The one case this still can't recover: if the last lap's
 * `finish_wp` IS the very last WayPoints row (no trailing rows at all), there
 * is no row left to place the closing edge on — not a real-world case for
 * Qstarz, which always keeps logging past the finish line.
 */
function buildLapNumberChannel(
  laps: SanaLap[],
  rowCount: number,
  wpIdToRowIndex: Map<number, number>,
): Float32Array | null {
  if (laps.length === 0) return null

  const counter = new Float32Array(rowCount)
  let lapNo = 0
  let cursor = 0
  for (const lap of laps) {
    const startIdx = wpIdToRowIndex.get(lap.startWp)
    const finishIdx = wpIdToRowIndex.get(lap.finishWp)
    if (finishIdx === undefined) continue
    // Rows between the previous cursor and this lap's start (if any gap)
    // stay at the current (pre-increment) lap number.
    if (startIdx !== undefined && startIdx > cursor) {
      for (let i = cursor; i < startIdx && i < rowCount; i++) counter[i] = lapNo
      cursor = startIdx
    }
    lapNo += 1
    for (let i = cursor; i <= finishIdx && i < rowCount; i++) counter[i] = lapNo
    cursor = finishIdx + 1
  }
  // Rows after the last lap's finish_wp are a separate out-lap (a distinct,
  // incremented counter value), NOT a continuation of the last lap — this is
  // what creates the closing rising edge for the final lap. If there are no
  // trailing rows (cursor already reached rowCount), or no lap was actually
  // recognised (e.g. every finish_wp was unmatched), there is nothing to do.
  if (lapNo > 0 && cursor < rowCount) {
    lapNo += 1
    for (let i = cursor; i < rowCount; i++) counter[i] = lapNo
  }
  return lapNo > 0 ? counter : null
}

/** One column of WayPoints values, indexed by row. */
type Column = number[]

/**
 * Parse a `.rcnx` (Qstarz ZIP/SQLite) into a LogSession with formatId 'rcnx'.
 *
 * @param bytes         The whole `.rcnx` file.
 * @param wasmLocateUrl Optional URL of `sql-wasm.wasm` (required in a browser
 *                      worker; omit under node where sql.js self-locates).
 * @param sessionIndex  Optional explicit `sess_N` index to open (from
 *                      `listRcnxSessions`). Omit to keep the default
 *                      behaviour: pick the session with the most WayPoints.
 */
export async function parseRcnx(
  bytes: Uint8Array,
  wasmLocateUrl?: string,
  sessionIndex?: number,
): Promise<LogSession> {
  const entries = readEntries(bytes)

  // --- collect all sess_N.db candidates ---
  const sessions: { n: number; bytes: Uint8Array }[] = []
  for (const [name, data] of entries) {
    const m = name.match(/^sess_(\d+)\.db$/)
    if (!m) continue
    sessions.push({ n: Number(m[1]), bytes: data })
  }
  if (sessions.length === 0) {
    throw new Error('RCNX: no sess_N.db found in archive')
  }
  // Stable order by index so ties resolve deterministically (lowest N first).
  sessions.sort((a, b) => a.n - b.n)

  // --- init sql.js (WASM) ---
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs(
    wasmLocateUrl ? { locateFile: () => wasmLocateUrl } : undefined,
  )

  // --- pick the session: explicit sessionIndex, or the one with the most
  // WayPoints (db byte length is only a coarse proxy — small sessions can
  // share a page count — so count rows directly with a cheap COUNT(*)). ---
  let chosenN = -1
  let chosenBytes: Uint8Array | null = null
  if (sessionIndex !== undefined) {
    const match = sessions.find((s) => s.n === sessionIndex)
    if (!match) {
      throw new Error(`RCNX: no sess_${sessionIndex}.db found in archive`)
    }
    chosenN = match.n
    chosenBytes = match.bytes
  } else {
    let bestCount = -1
    for (const s of sessions) {
      const probe = new SQL.Database(s.bytes)
      let count = 0
      try {
        const r = probe.exec('SELECT COUNT(*) FROM WayPoints')
        count = Number(r[0]?.values?.[0]?.[0] ?? 0)
      } finally {
        probe.close()
      }
      if (count > bestCount) {
        bestCount = count
        chosenN = s.n
        chosenBytes = s.bytes
      }
    }
  }
  if (!chosenBytes || chosenN < 0) {
    throw new Error('RCNX: no readable sess_N.db found in archive')
  }

  // --- summary_N.txt for the chosen session (optional, for metadata) ---
  const summaryBytes = entries.get(`summary_${chosenN}.txt`)
  const summary = summaryBytes ? parseSummary(summaryBytes) : {}

  // --- open the chosen session db ---
  const db = new SQL.Database(chosenBytes)

  let model = summary.model
  try {
    // `info` table: model lives at name='model' (e.g. 'LT-Q6000'). Optional.
    if (!model) {
      const infoRes = db.exec("SELECT value FROM info WHERE name = 'model'")
      const v = infoRes[0]?.values?.[0]?.[0]
      if (typeof v === 'string' && v.length > 0) model = v
    }

    const res = db.exec(
      'SELECT id, time, ms, lat, lon, altitude, heading, speed, Gx, Gy, Gz, distance ' +
        'FROM WayPoints ORDER BY id',
    )
    if (res.length === 0 || res[0].values.length === 0) {
      throw new Error('RCNX: WayPoints table is empty')
    }
    const { columns, values } = res[0]
    const col = (name: string): Column => {
      const idx = columns.indexOf(name)
      return values.map((row) => {
        const v = row[idx]
        return typeof v === 'number' ? v : Number(v)
      })
    }

    const rowCount = values.length
    const time = col('time')
    const ms = col('ms')
    const t0 = time[0] * 1000 + ms[0]

    const channels: Channel[] = []
    const pushChannel = (name: string, data: Float32Array, unit?: string): void => {
      channels.push({ name, rawName: name, description: undefined, unit, data })
    }
    /** Build a Float32Array channel directly from a source column. */
    const pushCol = (name: string, source: Column, unit?: string): void => {
      const data = new Float32Array(rowCount)
      for (let i = 0; i < rowCount; i++) data[i] = source[i]
      pushChannel(name, data, unit)
    }

    // Time (ms, first = 0).
    const timeData = new Float32Array(rowCount)
    for (let i = 0; i < rowCount; i++) timeData[i] = time[i] * 1000 + ms[i] - t0
    pushChannel('Time', timeData, 'ms')

    pushCol('GPS_Lat', col('lat'), '°')
    pushCol('GPS_Lon', col('lon'), '°')
    pushCol('GPS_Speed', col('speed'), 'km/h')
    pushCol('GPS_Course', col('heading'), '°')
    pushCol('GPS_Altitude', col('altitude'), 'm')
    pushCol('Gx', col('Gx'), 'g')
    pushCol('Gy', col('Gy'), 'g')
    pushCol('Gz', col('Gz'), 'g')
    pushCol('distance', col('distance'), 'km')

    // --- lap data (optional, from the matching sana_N.db) ---
    const wpId = col('id')
    const wpIdToRowIndex = new Map<number, number>()
    for (let i = 0; i < rowCount; i++) wpIdToRowIndex.set(wpId[i], i)
    const sanaLaps = readSanaLaps(entries.get(`sana_${chosenN}.db`), SQL)
    const lapChannelData = buildLapNumberChannel(sanaLaps, rowCount, wpIdToRowIndex)
    if (lapChannelData) pushChannel('IR_LapNumber', lapChannelData)

    // --- meta ---
    const startTimeSec = Number(summary.startTime)
    const createdEpochMs =
      Number.isFinite(startTimeSec) && startTimeSec > 0
        ? startTimeSec * 1000
        : t0 // fallback: first WayPoint time*1000+ms
    const createdDate = Number.isFinite(createdEpochMs)
      ? new Date(createdEpochMs)
      : null

    const headerInfo: Record<string, string> = {}
    if (summary.sName) headerInfo.trackName = String(summary.sName)
    if (model) headerInfo.model = String(model)
    if (summary.nHz) headerInfo.sampleRateHz = String(summary.nHz)
    headerInfo.sessionCount = String(sessions.length)
    headerInfo.sessionIndex = String(chosenN)
    if (sanaLaps.length > 0) {
      const validLaps = sanaLaps.filter((l) => !l.bFailed).length
      headerInfo.lapCount = String(sanaLaps.length)
      headerInfo.validLapCount = String(validLaps)
    }

    const meta: LogMeta = { formatId: 'rcnx', createdDate, headerInfo }
    return new LogSession(channels, meta)
  } finally {
    db.close()
  }
}
