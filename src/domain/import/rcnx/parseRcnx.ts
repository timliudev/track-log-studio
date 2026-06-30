/**
 * Qstarz QRacing `.rcnx` importer (LT-Q6000 / Q6000S lap-timer GPS logger).
 *
 * An `.rcnx` is a ZIP container holding one or more "sessions"; each session is
 * three files (`N = 0, 1, 2, …`). Note: every ZIP entry name carries a trailing
 * NUL byte that must be stripped (`name.replace(/\0+$/, '')`).
 *
 *  - `sess_N.db`     — SQLite 3. Main GPS/telemetry track in table `WayPoints`.
 *  - `sana_N.db`     — SQLite 3. Derived lap/split analysis cache (not read).
 *  - `summary_N.txt` — UTF-16LE text, alternating key-line / value-line.
 *
 * The pipeline returns ONE LogSession per file, so we pick the session with the
 * most WayPoints (proxied by the largest `sess_N.db` byte length).
 *
 * `WayPoints` columns → canonical channels (units already correct, no scaling):
 *   time*1000 + ms − t0 → Time (ms, first = 0)
 *   lat → GPS_Lat (deg), lon → GPS_Lon (deg, E positive)
 *   speed → GPS_Speed (km/h), heading → GPS_Course (deg)
 *   altitude → GPS_Altitude (m), Gx/Gy/Gz (g), distance (km, cumulative).
 * There is no satellite-count column, so no Satellites channel.
 *
 * Unlike RCZ (pure-JS binary), the payload here is SQLite, which the browser
 * cannot read with node:sqlite — we use sql.js (SQLite compiled to WASM). In the
 * browser worker the caller passes `wasmLocateUrl` (the Vite-resolved wasm asset
 * URL); under node/vitest it is undefined and sql.js finds its own wasm.
 */
import { unzipSync } from 'fflate'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'

/** Strip the trailing NUL byte(s) Qstarz appends to every ZIP entry name. */
function stripNul(name: string): string {
  return name.replace(/\0+$/, '')
}

/**
 * Parse a `summary_N.txt` (UTF-16LE) into a key→value map. The file is a flat
 * sequence of non-empty lines that alternate key, value, key, value, …
 */
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

/** One column of WayPoints values, indexed by row. */
type Column = number[]

/**
 * Parse a `.rcnx` (Qstarz ZIP/SQLite) into a LogSession with formatId 'rcnx'.
 *
 * @param bytes         The whole `.rcnx` file.
 * @param wasmLocateUrl Optional URL of `sql-wasm.wasm` (required in a browser
 *                      worker; omit under node where sql.js self-locates).
 */
export async function parseRcnx(
  bytes: Uint8Array,
  wasmLocateUrl?: string,
): Promise<LogSession> {
  const rawEntries = unzipSync(bytes)
  const entries = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(rawEntries)) {
    entries.set(stripNul(name), data)
  }

  // --- pick the session with the most WayPoints (largest sess_N.db) ---
  let chosenN = -1
  let chosenBytes: Uint8Array | null = null
  let chosenLen = -1
  const sessionIds = new Set<number>()
  for (const [name, data] of entries) {
    const m = name.match(/^sess_(\d+)\.db$/)
    if (!m) continue
    const n = Number(m[1])
    sessionIds.add(n)
    if (data.byteLength > chosenLen) {
      chosenLen = data.byteLength
      chosenN = n
      chosenBytes = data
    }
  }
  if (!chosenBytes || chosenN < 0) {
    throw new Error('RCNX: no sess_N.db found in archive')
  }

  // --- summary_N.txt for the chosen session (optional, for metadata) ---
  const summaryBytes = entries.get(`summary_${chosenN}.txt`)
  const summary = summaryBytes ? parseSummary(summaryBytes) : {}

  // --- init sql.js (WASM) and open the session db ---
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs(
    wasmLocateUrl ? { locateFile: () => wasmLocateUrl } : undefined,
  )
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
      'SELECT time, ms, lat, lon, altitude, heading, speed, Gx, Gy, Gz, distance ' +
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
    const pushChannel = (name: string, data: Float32Array): void => {
      channels.push({ name, rawName: name, description: undefined, data })
    }
    /** Build a Float32Array channel directly from a source column. */
    const pushCol = (name: string, source: Column): void => {
      const data = new Float32Array(rowCount)
      for (let i = 0; i < rowCount; i++) data[i] = source[i]
      pushChannel(name, data)
    }

    // Time (ms, first = 0).
    const timeData = new Float32Array(rowCount)
    for (let i = 0; i < rowCount; i++) timeData[i] = time[i] * 1000 + ms[i] - t0
    pushChannel('Time', timeData)

    pushCol('GPS_Lat', col('lat'))
    pushCol('GPS_Lon', col('lon'))
    pushCol('GPS_Speed', col('speed'))
    pushCol('GPS_Course', col('heading'))
    pushCol('GPS_Altitude', col('altitude'))
    pushCol('Gx', col('Gx'))
    pushCol('Gy', col('Gy'))
    pushCol('Gz', col('Gz'))
    pushCol('distance', col('distance'))

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
    headerInfo.sessionCount = String(sessionIds.size)
    headerInfo.sessionIndex = String(chosenN)

    const meta: LogMeta = { formatId: 'rcnx', createdDate, headerInfo }
    return new LogSession(channels, meta)
  } finally {
    db.close()
  }
}
