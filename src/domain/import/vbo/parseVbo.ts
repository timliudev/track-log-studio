/**
 * VBO (RaceBox / VBOX) importer — the inverse of {@link convertToVbo}.
 *
 * Parses a `.vbo` file (Circuit Tools `_ct` original-ECU-name flavour, or
 * RaceChrono `_rc` rc_-identifier flavour) into a {@link LogSession}. The four
 * sections used are `[header]` (one channel title per line), `[channel units]`
 * (one unit per line, parallel to header), `[column names]` (a single
 * space-separated line of column tokens) and `[data]` (space-separated numeric
 * rows). The 7 fixed GPS base columns are `sats time lat long velocity heading
 * height`; remaining columns become telemetry channels.
 *
 * Coordinate inversion mirrors the exporter exactly so a round-trip is faithful:
 *   exporter wrote `lat * 60`  → importer reads  `GPS_Lat = lat_minutes / 60`
 *   exporter wrote `lon * -60` → importer reads  `GPS_Lon = -long_minutes / 60`
 *     (VBOX convention: +longitude minutes = West)
 */
import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'
import { canonicalName, descriptionOf } from '@/domain/parsing/canonical'
import { decodeExportMetadata, type ExportMetadata } from '@/domain/export/metadata'

/** The 7 fixed VBO GPS column tokens, in order. */
const BASE_TOKENS = ['sats', 'time', 'lat', 'long', 'velocity', 'heading', 'height'] as const

/**
 * Safety cap on the total grid size (`columns × rows`) we will allocate.
 *
 * The grid is stored as one `Float32Array` per column, so the float count is
 * `ncol * n`. Both factors are attacker-controlled and *independent*: a crafted
 * file can pair one enormous `[column names]` line with many tiny `[data]`
 * lines, making `ncol * n` grow ~quadratically in the (small) file size — an
 * in-parser amplification bomb that would OOM the tab. The largest real logs
 * are tens of columns × a few hundred-thousand rows (well under 1e8 cells), so
 * this very generous ceiling never rejects a genuine file while refusing the
 * pathological case with a clear error (mirrors the zip-bomb guard in zip.ts).
 */
const MAX_GRID_CELLS = 500_000_000 // 500M floats ≈ 2 GB of Float32

interface Sections {
  header: string[]
  units: string[]
  columns: string[]
  dataLines: string[]
  /** The "File created on DD/MM/YYYY at HH:MM:SS" preamble line, if present. */
  createdLine: string | null
  comments: string[]
}

/** Split the raw text into VBO sections. Lines are CR/LF tolerant. */
function splitSections(text: string): Sections {
  const lines = text.split(/\r?\n/)
  const out: Sections = {
    header: [],
    units: [],
    columns: [],
    dataLines: [],
    createdLine: null,
    comments: [],
  }
  let section = 'preamble'
  for (const raw of lines) {
    const line = raw
    const trimmed = line.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      section = trimmed.toLowerCase()
      continue
    }
    switch (section) {
      case 'preamble':
        if (out.createdLine === null && /^File created on /i.test(trimmed)) {
          out.createdLine = trimmed
        }
        break
      case '[header]':
        if (trimmed) out.header.push(trimmed)
        break
      case '[channel units]':
        // Units may legitimately be blank, but the section never has gaps in
        // practice; keep non-empty lines parallel to the header.
        if (trimmed) out.units.push(trimmed)
        break
      case '[column names]':
        // NB: assign/iterate rather than `push(...split)` — spreading a huge
        // token array as call arguments overflows the stack (RangeError) on a
        // crafted multi-hundred-thousand-token line. A plain loop is O(n) and
        // bounded only by memory, letting the later grid-size guard reject it.
        if (trimmed) for (const tok of trimmed.split(/\s+/)) out.columns.push(tok)
        break
      case '[comments]':
        if (trimmed) out.comments.push(trimmed)
        break
      case '[data]':
        if (trimmed) out.dataLines.push(trimmed)
        break
      default:
        break
    }
  }
  return out
}

/** Parse "File created on DD/MM/YYYY at HH:MM:SS" → Date, or null. */
function parseCreatedDate(line: string | null): Date | null {
  if (!line) return null
  const m = line.match(
    /File created on (\d{2})\/(\d{2})\/(\d{4}) at (\d{2}):(\d{2}):(\d{2})/i,
  )
  if (!m) return null
  const [, dd, mm, yyyy, hh, min, ss] = m
  const d = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(min),
    Number(ss),
  )
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Decode an already-parsed VBO `time` value (HHMMSS.sss, UTC time-of-day) into
 * its hours, minutes, seconds and milliseconds parts. Returns null for a
 * non-finite (NaN) cell.
 */
function decodeVboTime(v: number): { hh: number; mm: number; ss: number; ms: number } | null {
  if (!Number.isFinite(v)) return null
  const hh = Math.floor(v / 10000)
  const mm = Math.floor((v % 10000) / 100)
  const secs = v % 100
  const ss = Math.floor(secs)
  const ms = Math.round((secs - ss) * 1000)
  return { hh, mm, ss, ms }
}

/** Parse a `.vbo` file into a LogSession with formatId 'vbo'. */
export function parseVbo(text: string): LogSession {
  const { header, units, columns, dataLines, createdLine, comments } = splitSections(text)

  if (columns.length === 0) {
    throw new Error('VBO: missing [column names] section')
  }

  const n = dataLines.length
  const ncol = columns.length

  // Refuse a pathologically large grid before allocating anything. `ncol` and
  // `n` are independent attacker inputs, so their product can blow up far faster
  // than the file size (see MAX_GRID_CELLS); guard against the OOM here.
  if (ncol * n > MAX_GRID_CELLS) {
    throw new Error(
      `VBO: refusing to allocate a ${ncol}×${n} grid ` +
        `(exceeds the ${MAX_GRID_CELLS.toLocaleString()}-cell safety limit)`,
    )
  }

  // Parse the [data] grid into one Float32Array per column.
  const colData: Float32Array[] = columns.map(() => new Float32Array(n))
  for (let i = 0; i < n; i++) {
    const fields = dataLines[i].split(/\s+/)
    for (let c = 0; c < ncol; c++) {
      const v = Number(fields[c])
      colData[c][i] = Number.isFinite(v) ? v : NaN
    }
  }

  const idxOf = (token: string): number => columns.indexOf(token)

  const channels: Channel[] = []
  const push = (name: string, rawName: string, description: string | undefined, data: Float32Array) =>
    channels.push({ name, rawName, description, data })

  // --- Time column → elapsed Time (ms) + GPS_UTC_hh/mm/ss/ms ---
  const timeIdx = idxOf('time')
  if (timeIdx >= 0) {
    const utcHh = new Float32Array(n)
    const utcMm = new Float32Array(n)
    const utcSs = new Float32Array(n)
    const utcMs = new Float32Array(n)
    const elapsed = new Float32Array(n)
    let t0Ms = 0
    let haveT0 = false
    const timeCol = colData[timeIdx]
    for (let i = 0; i < n; i++) {
      const parts = decodeVboTime(timeCol[i])
      if (!parts) {
        utcHh[i] = NaN
        utcMm[i] = NaN
        utcSs[i] = NaN
        utcMs[i] = NaN
        elapsed[i] = NaN
        continue
      }
      utcHh[i] = parts.hh
      utcMm[i] = parts.mm
      utcSs[i] = parts.ss
      utcMs[i] = parts.ms
      const absMs = ((parts.hh * 60 + parts.mm) * 60 + parts.ss) * 1000 + parts.ms
      if (!haveT0) {
        t0Ms = absMs
        haveT0 = true
      }
      let e = absMs - t0Ms
      if (e < 0) e += 86400_000 // wrap past midnight
      elapsed[i] = e
    }
    push('Time', 'Time', 'Elapsed time (ms)', elapsed)
    push('GPS_UTC_hh', 'GPS_UTC_hh', 'GPS UTC hours', utcHh)
    push('GPS_UTC_mm', 'GPS_UTC_mm', 'GPS UTC minutes', utcMm)
    push('GPS_UTC_ss', 'GPS_UTC_ss', 'GPS UTC seconds', utcSs)
    push('GPS_UTC_ms', 'GPS_UTC_ms', 'GPS UTC milliseconds', utcMs)
  }

  // --- lat/long (GPS minutes) → decimal degrees ---
  const latIdx = idxOf('lat')
  const lonIdx = idxOf('long')
  if (latIdx >= 0 && lonIdx >= 0) {
    const lat = new Float32Array(n)
    const lon = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      lat[i] = colData[latIdx][i] / 60 // exporter wrote lat * 60
      lon[i] = -colData[lonIdx][i] / 60 // exporter wrote lon * -60 (West positive)
    }
    push('GPS_Lat', 'GPS_Lat', 'GPS Latitude (°)', lat)
    push('GPS_Lon', 'GPS_Lon', 'GPS Longitude (°)', lon)
  }

  // --- velocity / heading / height / satellites ---
  const velIdx = idxOf('velocity')
  if (velIdx >= 0) push('GPS_Speed', 'GPS_Speed', 'GPS Speed (km/h)', colData[velIdx])
  const headIdx = idxOf('heading')
  if (headIdx >= 0) push('GPS_Course', 'GPS_Course', 'GPS Course (°)', colData[headIdx])
  const heightIdx = idxOf('height')
  if (heightIdx >= 0) push('GPS_Altitude', 'GPS_Altitude', 'GPS Altitude (m)', colData[heightIdx])
  const satsIdx = idxOf('sats')
  if (satsIdx >= 0) push('Satellites', 'Satellites', 'Satellites in fix', colData[satsIdx])

  // --- Remaining (non-base) columns → telemetry channels ---
  const baseSet = new Set<string>(BASE_TOKENS)
  for (let c = 0; c < ncol; c++) {
    const token = columns[c]
    if (baseSet.has(token)) continue
    // Prefer the [header] title (carries the original ECU name in the _ct
    // flavour), falling back to the column token.
    const rawName = header[c] ?? token
    const name = canonicalName(rawName)
    if (name === '') continue
    push(name, rawName, descriptionOf(rawName), colData[c])
  }

  const headerInfo: Record<string, string> = {}
  let exportMetadata: ExportMetadata = {}
  for (const line of comments) {
    const m = line.match(/^([^:]+):\s*(.+)$/)
    if (m) {
      const key = m[1].trim()
      const value = m[2].trim()
      headerInfo[key] = value
      if (key === 'TLS-Metadata') exportMetadata = decodeExportMetadata(value)
    }
  }

  const meta: LogMeta = {
    formatId: 'vbo',
    createdDate: parseCreatedDate(createdLine),
    headerInfo,
    exportMetadata,
  }
  // Reference `units` to keep it available for future unit-aware mapping; it is
  // parallel to `header` but not currently surfaced on Channel.
  void units

  return new LogSession(channels, meta)
}
