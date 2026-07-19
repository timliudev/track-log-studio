import type { LogSession } from '@/domain/model/LogSession'
import { makeFixResolver } from '@/domain/gps/gpsFix'
import { GPS_CONSUMED } from '@/domain/export/vbo/semantic'
import { exportMetadataHeader, type ExportMetadata } from '@/domain/export/metadata'

/**
 * ECU/GPS columns that are either folded into the leading GPS_Lat/GPS_Lon/
 * GPS_Speed columns or are the raw encodings behind them, so they must not
 * also appear as trailing generic channels (that would duplicate the same
 * physical signal under two headers).
 *
 * Reuses the VBO exporter's {@link GPS_CONSUMED} set (raw deg/min/mmmm/NS/EW
 * encoding, `Time`, and the `GPS_UTC_*` clock columns) and additionally skips
 * the decimal `GPS_Lat`/`GPS_Lon` themselves, since those are exactly the
 * leading columns this exporter already emits.
 */
const CSV_GPS_DUPES: ReadonlySet<string> = new Set([...GPS_CONSUMED, 'GPS_Lat', 'GPS_Lon'])

/** One output file produced from a single session. */
export interface CsvArtifact {
  readonly suffix: ''
  readonly ext: 'csv'
  readonly content: string
}

/** Line ending used by the generic CSV export. Plain `\n` — see module docs. */
const EOL = '\n'

/** Read a Float32 cell as a number, or undefined if missing/NaN ("no value"). */
function cell(a: Float32Array | undefined, i: number): number | undefined {
  if (!a) return undefined
  const v = a[i]
  return Number.isFinite(v) ? v : undefined
}

/**
 * Render a telemetry number as a plain decimal, or '' for no value. Values
 * come out of a `Float32Array`, whose ~7-significant-digit storage otherwise
 * prints long noisy tails via `String()` (e.g. `50.5` → `50.5` is fine, but a
 * value like `24.501` round-trips through Float32 as `24.500999450683594`).
 * Fixed to 4 decimals and trailing zeros stripped — same convention as the
 * .vbo writer's `fmtNum` (see `vbo/format.ts`) — keeps output clean while
 * still exact for the RPM/percent/temperature-scale values these logs carry.
 */
function fmt(v: number | undefined): string {
  if (v === undefined) return ''
  if (Number.isInteger(v)) return String(v)
  const s = v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return s === '' || s === '-' ? '0' : s
}

/**
 * Render a GPS decimal-degree coordinate with enough precision to preserve
 * track position (7 decimal places ≈ 1.1 cm at the equator — well under GPS
 * receiver accuracy), trimming trailing zeros the same way as {@link fmt}.
 * A plain `fmt` (4 decimals ≈ 11 m) would be too coarse for lat/lon.
 */
function fmtCoord(v: number | undefined): string {
  if (v === undefined) return ''
  if (Number.isInteger(v)) return String(v)
  const s = v.toFixed(7).replace(/0+$/, '').replace(/\.$/, '')
  return s === '' || s === '-' ? '0' : s
}

/**
 * Quote a CSV field per RFC 4180: wrap in double quotes and escape embedded
 * quotes if the field contains a comma, double quote, or newline. Channel
 * names in this codebase never contain these characters today, but the
 * numeric cells are always plain decimals so this only ever fires for names.
 *
 * Also guards against spreadsheet formula injection: a channel's `name`
 * originates from whatever header/label text the SOURCE file (any importer,
 * including a hand-crafted malicious one) used, so a leading `=`, `+`, `-`,
 * `@`, or tab/CR is neutralised with a leading `'` before Excel/LibreOffice
 * ever gets a chance to evaluate it as a formula on open.
 */
function csvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (/[",\n\r]/.test(guarded)) return '"' + guarded.replace(/"/g, '""') + '"'
  return guarded
}

/**
 * Convert a session into a single generic CSV: one row per sample, importable
 * by Race Studio 3, Excel, Python/pandas, or any other spreadsheet/analysis
 * tool. Unlike the RC3/.nmea format (a handful of user-mapped sensor slots)
 * or the .vbo format (RaceChrono/Circuit-Tools-specific channel identifiers),
 * this format has no target-app naming constraints, so it simply emits every
 * channel under its own aRacer canonical name.
 *
 * Format decisions (see docs/ARCHITECTURE-FORMATS.md for the rationale):
 *  - Header row: `Time,GPS_Lat,GPS_Lon,GPS_Speed` followed by every other
 *    channel (derived suspension channels included, same as the .vbo path),
 *    in session channel order. GPS raw-encoding columns and channels already
 *    represented by the four leading columns are skipped (see
 *    {@link CSV_GPS_DUPES}) so no signal is duplicated under two headers.
 *  - `GPS_Lat`/`GPS_Lon` are resolved through the shared {@link makeFixResolver}
 *    (same source the .nmea exporter uses) so both encodings aRacer produces
 *    (integer deg/min/mmmm+NS/EW, and decimal degrees from NMEA/MX-APP
 *    imports) come out as plain decimal degrees; a row with no GPS fix gets
 *    empty lat/lon cells rather than a synthesized 0,0.
 *  - Numbers: plain decimal point, no thousands separators, no scientific
 *    notation. Telemetry channels use up to 4 decimals with trailing zeros
 *    stripped (same convention as the .vbo writer's `fmtNum`); GPS lat/lon use
 *    up to 7 decimals (~1.1 cm resolution) since 4 decimal degrees (~11 m)
 *    would be too coarse for track position. Both strip Float32 storage noise
 *    (e.g. a value that round-trips through `Float32Array` as
 *    `24.500999450683594` prints as `24.501`). NaN / missing samples become an
 *    empty cell, never `0`.
 *  - Line ending: `\n` (LF only). Race Studio 3 and Excel both accept LF-only
 *    CSVs on import; using a single, documented convention avoids the mixed
 *    EOL edge cases `\r\n` can create when a file is later hand-edited on
 *    Linux/macOS.
 *  - Encoding: UTF-8 **without** BOM. Channel names are the ASCII-only aRacer
 *    canonical names (unlike `_channels.csv`, which embeds Chinese
 *    descriptions and therefore needs the BOM for Excel); RS3 and pandas both
 *    assume BOM-less UTF-8/ASCII for plain data CSVs.
 *  - Portable annotations use one trailing `TLS_Metadata/...` header with an
 *    empty value in every data row. This remains a regular RFC 4180 column,
 *    keeps all existing channel positions intact, and avoids non-standard
 *    leading comment lines which some telemetry importers treat as data.
 */
export function convertToCsv(session: LogSession, metadata?: ExportMetadata): CsvArtifact[] {
  const n = session.rowCount
  const timeCh = session.timeChannel?.data
  const fixResolver = makeFixResolver(session)
  const speedCh = session.get('GPS_Speed')?.data

  const otherChannels = session.channels.filter(
    (c) => c.name !== '' && c.name !== session.timeChannel?.name && !CSV_GPS_DUPES.has(c.name),
  )

  const metadataHeader = exportMetadataHeader(metadata)
  const header = [
    'Time',
    'GPS_Lat',
    'GPS_Lon',
    'GPS_Speed',
    ...otherChannels.map((c) => c.name),
    ...(metadataHeader ? [metadataHeader] : []),
  ]
  const lines: string[] = [header.map(csvField).join(',')]

  for (let i = 0; i < n; i++) {
    const fix = fixResolver.fixAt(i)
    const row = [
      fmt(cell(timeCh, i)),
      fix ? fmtCoord(fix.latDd) : '',
      fix ? fmtCoord(fix.lonDd) : '',
      fmt(cell(speedCh, i)),
      ...otherChannels.map((c) => fmt(cell(c.data, i))),
      ...(metadataHeader ? [''] : []),
    ]
    lines.push(row.join(','))
  }

  return [{ suffix: '', ext: 'csv', content: lines.join(EOL) + EOL }]
}
