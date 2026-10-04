import type { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { computeSmoothedCourses } from '@/domain/export/rc3Nmea/heading'
import { fmtNum, padFloat, padInt } from './format'
import { demoteConstantToAnalog } from './channelNaming'
import {
  ANALOG_BASES,
  Allocator,
  DIGITAL_BASES,
  GPS_CONSUMED,
  SEMANTIC,
  humanize,
  isRcIdentifier,
} from './semantic'
import { encodeExportMetadata, normalizeExportMetadata, type ExportMetadata } from '@/domain/export/metadata'

const EOL = '\r\n'

/** The 7 fixed VBO GPS columns: [header title, [column names] token, unit]. */
const BASE_HEADER: ReadonlyArray<readonly [string, string, string]> = [
  ['satellites', 'sats', 'count'],
  ['time', 'time', 's'],
  ['latitude', 'lat', 'minutes'],
  ['longitude', 'long', 'minutes'],
  ['velocity kmh', 'velocity', 'km/h'],
  ['heading', 'heading', 'degrees'],
  ['height', 'height', 'm'],
]

/**
 * `GPS_Altitude`/`Satellites` are folded into the standard `height`/`sats`
 * columns (B122) — but ONLY here. Unlike {@link GPS_CONSUMED}, this set is
 * NOT shared with `CsvExporter.ts`: the generic CSV format has no standard
 * altitude/satellite-count columns to fall these into, so it must keep
 * emitting them as ordinary data columns.
 */
const VBO_ONLY_CONSUMED: ReadonlySet<string> = new Set(['GPS_Altitude', 'Satellites'])

/** How a channel was classified when assigning its RaceChrono identifier. */
export type VboKind = 'semantic' | 'passthrough' | 'analog' | 'digital'

/** One non-GPS ECU channel resolved for both .vbo flavours. */
export interface VboChannel {
  /** Original ECU canonical name (Circuit Tools header). */
  readonly ctTitle: string
  /** ECU name sanitised for the [column names] token (spaces/dots → '_'). */
  readonly ctToken: string
  /** RaceChrono `rc_` identifier (its header *and* token). */
  readonly rcName: string
  /** Approximate RaceChrono App display label for {@link rcName}. */
  readonly rcLabel: string
  readonly unit: string
  readonly data: Float32Array
  readonly scale: number
  readonly kind: VboKind
  readonly description: string
}

/**
 * A channel dropped entirely from the .vbo output because its data is
 * entirely NaN (no data at all — see B124). Still reported to the user via
 * `_channels.csv` / {@link buildVboDisplayMap} so it's clear the signal was
 * seen but intentionally skipped, not silently lost.
 */
export interface VboSkippedChannel {
  readonly ctTitle: string
  readonly description: string
  readonly unit: string
}

/** Result of classifying every non-GPS channel of a session. */
export interface VboCatalog {
  readonly channels: VboChannel[]
  readonly skipped: VboSkippedChannel[]
}

/** One row of the channel cross-reference, for the UI preview / _channels.csv. */
export interface VboMapRow {
  /** ECU canonical name, or the standard GPS channel title. */
  readonly ecu: string
  /** ECU description (after '/'), empty for GPS standard channels. */
  readonly description: string
  /** RaceChrono `rc_` identifier, or '' for the GPS standard channels. */
  readonly rcId: string
  readonly unit: string
  readonly kind: VboKind | 'gps' | 'skipped'
}

/** One output file produced from a single .loga. */
export interface VboArtifact {
  /** Filename suffix appended to the log stem, e.g. '_ct'. */
  readonly suffix: string
  readonly ext: 'vbo' | 'csv'
  readonly content: string
}

/** Read a Float32 cell as a finite number; NaN / missing → 0. */
function cell(a: Float32Array | undefined, i: number): number {
  if (!a) return 0
  const v = a[i]
  return Number.isFinite(v) ? v : 0
}

/**
 * True when a channel's RAW data (not the NaN→0-filled `cell()` view) has no
 * finite sample anywhere — i.e. the whole column is genuinely empty (B124).
 * Must be checked on the raw `Float32Array`: `cell()` already maps NaN to 0,
 * so testing post-`cell()` values would make an all-NaN channel look like a
 * constant-0 channel instead of "no data at all" — exactly the bug this
 * fixes (an all-NaN column was being misread as digital, see B125).
 * A zero-length session (`n === 0`) has nothing to judge, so it is never
 * treated as "empty" here — there's simply no data either way, and this keeps
 * a rowCount-0 session from dropping every channel outright.
 */
function isAllNaN(data: Float32Array, n: number): boolean {
  if (n === 0) return false
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(data[i])) return false
  }
  return true
}

/**
 * Value-range fallback for digital/analog classification — the LAST resort,
 * consulted only when nothing else (SEMANTIC mapping, a source unit) already
 * identifies the channel (B125). Historical semantics, restored: a channel
 * counts as digital when every FINITE sample is 0 or 1 (NaN cells are
 * skipped, never treated as 0 — that `cell()`-based conflation is exactly
 * what made an all-NaN channel look like a constant-0 digital channel
 * before B124 existed; do not reintroduce it here). A channel that already
 * has a source-supplied physical unit is never a boolean state, so it's
 * excluded up front — this part of B125 is genuinely right, it's what fixes
 * the DOP-style-float-happens-to-be-0/1 case.
 *
 * Deliberately does NOT require both a 0 and a 1 to appear (an earlier
 * version of this fix did, to auto-reject constant channels, but that
 * misfires on real ECU boolean flags that simply never fired in a given
 * log — e.g. `Malf8.Malf_On`, `Pit_SW_On` — which are still genuinely
 * digital signals, just constant-0 in this particular recording). Value range
 * alone cannot tell those apart from a constant-0 analog quantity
 * (`IR_LapNumber`, `SimRPM`, …); that residual ambiguity (B127) is resolved
 * by the caller, which applies the channel-NAME rule in `channelNaming.ts`
 * (`demoteConstantToAnalog`) on top of this function: a constant channel
 * whose name positively reads as a quantity and not as a flag is demoted to
 * analog. This function itself stays a pure value-range test.
 * B124 already removes the one case that motivated the "both values" rule
 * in .rcz — an all-NaN channel — before this function ever runs.
 */
function looksDigital(ch: Channel, n: number): boolean {
  if (ch.unit) return false
  for (let i = 0; i < n; i++) {
    const v = ch.data[i]
    if (!Number.isFinite(v)) continue
    if (v !== 0 && v !== 1) return false
  }
  return true
}

/**
 * Per-row decimal-degree coordinates for every sample (no validity gating —
 * Circuit Tools wants one GPS row per data row). Handles the aRacer integer
 * deg/min/mmmm + NS/EW encoding and falls back to decimal GPS_Lat/GPS_Lon
 * (NMEA import / MX APP phone logs); absent GPS yields zeros.
 */
function vboCoords(session: LogSession, n: number): { lat: number[]; lon: number[] } {
  const lat = new Array<number>(n)
  const lon = new Array<number>(n)

  const latDeg = session.get('GPS_Lat_deg')?.data
  const lonDeg = session.get('GPS_Lon_deg')?.data
  if (latDeg && lonDeg) {
    const latMin = session.get('GPS_Lat_min')?.data
    const latMmmm = session.get('GPS_Lat_mmmm')?.data
    const latNs = session.get('GPS_Lat_NS')?.data
    const lonMin = session.get('GPS_Lon_min')?.data
    const lonMmmm = session.get('GPS_Lon_mmmm')?.data
    const lonEw = session.get('GPS_Lon_EW')?.data
    for (let i = 0; i < n; i++) {
      const ld = Math.trunc(cell(latDeg, i))
      const lm = cell(latMin, i) + cell(latMmmm, i) / 10000
      const od = Math.trunc(cell(lonDeg, i))
      const om = cell(lonMin, i) + cell(lonMmmm, i) / 10000
      const ns = latNs ? String.fromCharCode(Math.trunc(cell(latNs, i))) : 'N'
      const ew = lonEw ? String.fromCharCode(Math.trunc(cell(lonEw, i))) : 'E'
      let la = ld + lm / 60
      if (ns === 'S') la = -la
      let lo = od + om / 60
      if (ew === 'W') lo = -lo
      lat[i] = la
      lon[i] = lo
    }
    return { lat, lon }
  }

  const dLat = session.get('GPS_Lat')?.data
  const dLon = session.get('GPS_Lon')?.data
  if (dLat && dLon) {
    for (let i = 0; i < n; i++) {
      lat[i] = cell(dLat, i)
      lon[i] = cell(dLon, i)
    }
    return { lat, lon }
  }

  lat.fill(0)
  lon.fill(0)
  return { lat, lon }
}

/**
 * Comments must never contain '[' or ']': a line like "...[header]..." is read
 * by Circuit Tools as a VBO section marker, so its parser re-enters section
 * parsing mid-comments and hangs. Replace any brackets with parentheses.
 */
function safeComment(s: string): string {
  return s.replace(/\[/g, '(').replace(/\]/g, ')')
}

/**
 * CSV field with Python csv.writer (QUOTE_MINIMAL) quoting rules, plus a
 * leading `'` guard against spreadsheet formula injection: this CSV can
 * carry attacker-controlled text round-tripped through an imported file's
 * TLS-Metadata (e.g. a CVT tuning note's label/value — see
 * domain/export/metadata.ts), and Excel/LibreOffice treat a cell starting
 * with `=`, `+`, `-`, `@`, or a tab/CR as a formula to evaluate on open.
 */
function csvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (/[",\r\n]/.test(guarded)) return '"' + guarded.replace(/"/g, '""') + '"'
  return guarded
}

function dd(v: number): string {
  return v.toString().padStart(2, '0')
}

/**
 * Classify every non-GPS channel and assign its RaceChrono `rc_` identifier:
 *  1. a SEMANTIC override (known ECU name, or a fixed RC3 slot like
 *     `rc_digital_1` -> `rc_rpm`, B121) — a semantic identifier + SI unit;
 *  2. a name that's already a valid RaceChrono `rc_` identifier (B120) —
 *     passed through unchanged, never re-bucketed;
 *  3. pure 0/1 columns — generic digital;
 *  4. everything else — generic analog (sequential allocation, so the order
 *     matches the .vbo output).
 * Channels whose data is entirely NaN (B124) are dropped from the output and
 * reported separately as `skipped`. Shared by the exporter and the UI preview.
 */
export function buildVboCatalog(session: LogSession): VboCatalog {
  const n = session.rowCount
  const alloc = new Allocator()
  const channels: VboChannel[] = []
  const skipped: VboSkippedChannel[] = []

  // Pass 1: reserve every channel whose name is ALREADY a valid rc_
  // identifier (and isn't overridden by SEMANTIC) with the Allocator, before
  // any generic bucket assignment happens. This makes a collision between a
  // passed-through name (e.g. source `rc_analog_5`) and a later generically
  // numbered channel impossible, not merely unlikely — regardless of which
  // one appears first in the session's channel order (B120).
  for (const ch of session.channels) {
    const name = ch.name
    if (name === '' || GPS_CONSUMED.has(name) || VBO_ONLY_CONSUMED.has(name)) continue
    if (isAllNaN(ch.data, n)) continue // B124: handled (and only decided) in pass 2
    if (SEMANTIC[name]) continue // overridden — not an identity passthrough
    if (isRcIdentifier(name)) alloc.reserve(name)
  }

  // Pass 2: classify + emit, in the session's original channel order.
  for (const ch of session.channels) {
    const name = ch.name
    if (name === '' || GPS_CONSUMED.has(name) || VBO_ONLY_CONSUMED.has(name)) continue

    if (isAllNaN(ch.data, n)) {
      skipped.push({ ctTitle: name, description: ch.description ?? '', unit: ch.unit ?? '' })
      continue
    }

    let rcName: string
    let scale: number
    let unit: string
    let kind: VboKind
    const sem = SEMANTIC[name]
    if (sem) {
      rcName = `rc_${sem.ident}`
      scale = sem.scale
      unit = sem.unit
      kind = 'semantic'
    } else if (isRcIdentifier(name)) {
      rcName = name
      scale = 1
      // Preserve the source-supplied unit (B123) — 'raw' only when the
      // importer didn't give one (e.g. the RC3 analog/digital bank, whose
      // int32ScaleFor has no validated physical unit).
      unit = ch.unit || 'raw'
      kind = 'passthrough'
    } else if (looksDigital(ch, n) && !demoteConstantToAnalog(name, ch.data, n)) {
      // digital bucket spills into analog when full (B127: a constant channel
      // with a quantity-like name was already routed to analog above).
      // looksDigital() already
      // requires an empty source unit (see its doc), so 'bool' here is never
      // overwriting a real physical unit.
      rcName = alloc.take([...DIGITAL_BASES, ...ANALOG_BASES])
      scale = 1
      unit = 'bool'
      kind = 'digital'
    } else {
      rcName = alloc.take(ANALOG_BASES)
      scale = 1
      unit = ch.unit || 'raw' // B123: preserve the source unit when the importer supplied one
      kind = 'analog'
    }

    channels.push({
      ctTitle: name,
      ctToken: name.replace(/ /g, '_').replace(/\./g, '_'),
      rcName,
      rcLabel: humanize(rcName),
      unit,
      data: ch.data,
      scale,
      kind,
      description: ch.description ?? '',
    })
  }
  return { channels, skipped }
}

/**
 * The channel cross-reference as display rows: the 7 standard GPS channels,
 * every ECU channel's rc_ mapping, then any channel skipped for having no
 * data at all (B124). Same content as _channels.csv, for rendering an in-app
 * preview.
 */
export function buildVboDisplayMap(session: LogSession): VboMapRow[] {
  const rows: VboMapRow[] = []
  for (const [title, , unit] of BASE_HEADER) {
    rows.push({ ecu: title, description: '', rcId: '', unit, kind: 'gps' })
  }
  const { channels, skipped } = buildVboCatalog(session)
  for (const c of channels) {
    rows.push({
      ecu: c.ctTitle,
      description: c.description,
      rcId: c.rcName,
      unit: c.unit,
      kind: c.kind,
    })
  }
  for (const s of skipped) {
    rows.push({
      ecu: s.ctTitle,
      description: s.description,
      rcId: '—',
      unit: s.unit,
      kind: 'skipped',
    })
  }
  return rows
}

/**
 * Convert one parsed .loga into the three VBO artifacts:
 *  - `_ct.vbo`  Circuit Tools 3 (original ECU channel names)
 *  - `_rc.vbo`  RaceChrono 10.2.x (`rc_` identifiers + embedded channel map)
 *  - `_channels.csv`  channel cross-reference (with Chinese descriptions)
 *
 * Faithfully ports loga2vbo.py while reusing the app's shared heading smoothing
 * so .nmea and .vbo agree on course. `sourceName` is the original file name (for
 * the [comments] attribution); `now` is only used when the log has no created
 * date.
 */
export function convertToVbo(
  session: LogSession,
  sourceName: string,
  now: Date = new Date(),
  metadata?: ExportMetadata,
): VboArtifact[] {
  const n = session.rowCount
  const created = session.meta.createdDate

  // --- GPS coordinates + smoothed heading (every row) ---
  const { lat, lon } = vboCoords(session, n)
  const courses = computeSmoothedCourses(lat, lon)
  const cGpsSpeed = session.get('GPS_Speed')?.data
  const cGpsAlt = session.get('GPS_Altitude')?.data
  const cSats = session.get('Satellites')?.data

  // --- VBO time field (UTC time-of-day, HHMMSS.sss). Source priority:
  //  1. GPS_UTC_hh/mm/ss/ms when present and not all-zero — the real GPS clock;
  //  2. else meta.firstSampleEpochMs (B126: the .rcz importer's first
  //     master-clock sample, more precise than createdDate) + elapsed `Time`;
  //  3. else the created date's time-of-day + elapsed `Time` column;
  //  4. else (no time column) the created date + a synthesized sample interval.
  // `createdDate` itself (and the "File created on …" stamp line below) is
  // NEVER replaced by firstSampleEpochMs — only the time-of-day anchor is.
  const timeCh = session.timeChannel?.data
  const stepMs = session.sampleIntervalMs ?? 100
  const t0 = timeCh && n > 0 ? cell(timeCh, 0) : 0
  const firstSampleEpochMs = session.meta.firstSampleEpochMs
  const timeBase = typeof firstSampleEpochMs === 'number' ? new Date(firstSampleEpochMs) : created
  const baseSecs = timeBase
    ? timeBase.getHours() * 3600 + timeBase.getMinutes() * 60 + timeBase.getSeconds()
    : 0

  const cUtcHh = session.get('GPS_UTC_hh')?.data
  const cUtcMm = session.get('GPS_UTC_mm')?.data
  const cUtcSs = session.get('GPS_UTC_ss')?.data
  const cUtcMs = session.get('GPS_UTC_ms')?.data
  let hasUtc = cUtcHh !== undefined && cUtcMm !== undefined && cUtcSs !== undefined
  if (hasUtc) {
    // An all-zero clock means the GPS never produced a UTC fix — fall back to
    // the created-date clock rather than stamping every row 00:00:00.
    let anyNonZero = false
    for (let i = 0; i < n; i++) {
      if (cell(cUtcHh, i) || cell(cUtcMm, i) || cell(cUtcSs, i) || cell(cUtcMs, i)) {
        anyNonZero = true
        break
      }
    }
    hasUtc = anyNonZero
  }

  const vboTime = (i: number): string => {
    if (hasUtc) {
      return (
        padInt(cell(cUtcHh, i), 2) +
        padInt(cell(cUtcMm, i), 2) +
        padInt(cell(cUtcSs, i), 2) +
        '.' +
        padInt(cUtcMs ? cell(cUtcMs, i) : 0, 3)
      )
    }
    const elapsed = timeCh ? cell(timeCh, i) - t0 : i * stepMs
    let sod = (baseSecs + elapsed / 1000) % 86400
    if (sod < 0) sod += 86400
    return (
      padInt(Math.floor(sod / 3600), 2) +
      padInt(Math.floor((sod % 3600) / 60), 2) +
      padFloat(sod % 60, 6, 3)
    )
  }

  // --- Pre-format the 7 base columns per row ---
  // sats/height fall back to the historical constants ('012' / +00000.00)
  // only when the source has no Satellites/GPS_Altitude channel at all
  // (B122) — same fixed-width formatting either way.
  const baseCells: string[][] = new Array(n)
  for (let i = 0; i < n; i++) {
    baseCells[i] = [
      cSats ? padInt(cell(cSats, i), 3) : '012',
      vboTime(i),
      padFloat(lat[i] * 60, 12, 5, true),
      padFloat(lon[i] * -60, 12, 5, true), // VBO convention: +longitude = West
      padFloat(cell(cGpsSpeed, i), 7, 3),
      padFloat(courses[i] ?? 0, 6, 2),
      cGpsAlt ? padFloat(cell(cGpsAlt, i), 9, 2, true) : padFloat(0, 9, 2, true),
    ]
  }

  // --- Classify each non-GPS channel and assign an rc_ identifier ---
  const { channels, skipped } = buildVboCatalog(session)

  // Channel-map comment block — shared by both flavours. (Circuit Tools hangs
  // on the literal "[header]", so _ct gets this bracket-free map too instead of
  // a "[header] uses original ECU names" note.)
  const commentMap = ['Channel map  ECU_name | RaceChrono_label | rc_id | unit']
  for (const c of channels) {
    commentMap.push(`  ${c.ctTitle} | ${c.rcLabel} | ${c.rcName} | ${c.unit}`)
  }
  const metadataPayload = encodeExportMetadata(metadata)

  // --- Render a .vbo (ct = ECU names, rc = rc_ identifiers) ---
  const stamp = created ?? now
  const stampLine =
    `File created on ${dd(stamp.getDate())}/${dd(stamp.getMonth() + 1)}/` +
    `${stamp.getFullYear()} at ${dd(stamp.getHours())}:${dd(stamp.getMinutes())}:` +
    `${dd(stamp.getSeconds())}`

  const renderVbo = (variant: 'ct' | 'rc'): string => {
    const out: string[] = []
    out.push(stampLine + EOL)

    out.push(EOL + '[header]' + EOL)
    for (const [title] of BASE_HEADER) out.push(title + EOL)
    for (const c of channels) out.push((variant === 'ct' ? c.ctTitle : c.rcName) + EOL)

    out.push(EOL + '[channel units]' + EOL)
    for (const [, , unit] of BASE_HEADER) out.push(unit + EOL)
    for (const c of channels) out.push(c.unit + EOL)

    out.push(EOL + '[comments]' + EOL)
    out.push(safeComment(`Converted from ${sourceName} by Track Log Studio (_${variant})`) + EOL)
    if (created) {
      const c = created
      out.push(
        safeComment(
          `Log created: ${c.getFullYear()}-${dd(c.getMonth() + 1)}-${dd(c.getDate())} ` +
            `${dd(c.getHours())}:${dd(c.getMinutes())}:${dd(c.getSeconds())}`,
        ) + EOL,
      )
    }
    if (metadataPayload) out.push(`TLS-Metadata: ${metadataPayload}` + EOL)
    for (const line of commentMap) out.push(safeComment(line) + EOL)

    out.push(EOL + '[column names]' + EOL)
    const tokens = [
      ...BASE_HEADER.map(([, token]) => token),
      ...channels.map((c) => (variant === 'ct' ? c.ctToken : c.rcName)),
    ]
    out.push(tokens.join(' ') + EOL)

    out.push(EOL + '[data]' + EOL)
    for (let i = 0; i < n; i++) {
      const fields = baseCells[i].slice()
      for (const c of channels) fields.push(fmtNum(cell(c.data, i) * c.scale))
      out.push(fields.join(' ') + EOL)
    }

    return out.join('')
  }

  // --- Render the channel cross-reference CSV (UTF-8 BOM for Excel) ---
  const renderCsv = (): string => {
    const kindLabel: Record<VboKind, string> = {
      semantic: '語意',
      passthrough: '直通',
      analog: '類比',
      digital: '數位',
    }
    const rows: string[][] = []
    rows.push([
      'ECU 欄位',
      '中文說明',
      'Circuit Tools 顯示',
      'RaceChrono 顯示(約略)',
      'RaceChrono rc_ 識別符',
      '單位',
      '類型',
    ])
    for (const [title, , unit] of BASE_HEADER) {
      rows.push([title, '(GPS/標準頻道)', title, title, '—', unit, 'GPS'])
    }
    for (const c of channels) {
      rows.push([
        c.ctTitle,
        c.description,
        c.ctTitle,
        c.rcLabel,
        c.rcName,
        c.unit,
        kindLabel[c.kind],
      ])
    }
    for (const s of skipped) {
      rows.push([s.ctTitle, s.description, s.ctTitle, s.ctTitle, '—', s.unit, '已略過(整條無資料)'])
    }
    const cvtNotes = normalizeExportMetadata(metadata).cvtNotes ?? []
    if (cvtNotes.length > 0) {
      rows.push([])
      rows.push(['CVT 調教備註', '值'])
      for (const note of cvtNotes) rows.push([note.label, note.value])
    }
    const body = rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n'
    return '﻿' + body // UTF-8 BOM so Excel reads the Chinese correctly
  }

  return [
    { suffix: '_ct', ext: 'vbo', content: renderVbo('ct') },
    { suffix: '_rc', ext: 'vbo', content: renderVbo('rc') },
    { suffix: '_channels', ext: 'csv', content: renderCsv() },
  ]
}
