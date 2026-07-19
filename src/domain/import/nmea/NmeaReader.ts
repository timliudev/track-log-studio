import { nmeaChecksum } from '@/domain/export/nmeaChecksum'
import { decodeExportMetadata, type ExportMetadata } from '@/domain/export/metadata'

/**
 * M9 P2: unlike the CSV importer (`MAX_PLAIN_CSV_CELLS`) and VBO importer
 * (`MAX_GRID_CELLS`), this legacy text importer never bounded its input at
 * all — an arbitrarily large `.nmea` file would run `text.split(/\r?\n/)`
 * and accumulate an unbounded `fixes` array with no cap, an easy DoS vector
 * for anything that lets a user pick an untrusted file. Real NMEA logs are
 * at most a few hundred thousand $GxRMC lines (hours at 10 Hz); 200M
 * characters is a very generous ceiling (comparable in scale to the
 * 512 MB byte caps `zip.ts`/`inflateXrz.ts` already use for binary formats)
 * that no genuine log will ever approach.
 */
export const MAX_NMEA_TEXT_CHARS = 200_000_000

export class NmeaParseError extends Error {
  constructor(message: string) {
    super(`NMEA: ${message}`)
    this.name = 'NmeaParseError'
  }
}

/** One GPS fix parsed from an NMEA stream. */
export interface NmeaFix {
  /** Milliseconds within the UTC day (from the time field). */
  timeMs: number
  /** Decimal degrees. */
  lat: number
  lon: number
  speedKnots: number
  /** Course over ground, degrees. */
  course: number
}

export interface NmeaData {
  fixes: NmeaFix[]
  exportMetadata: ExportMetadata
}

function checksumOk(line: string): boolean {
  const star = line.lastIndexOf('*')
  if (star < 0) return false
  return nmeaChecksum(line.slice(1, star)) === line.slice(star + 1).trim().toUpperCase()
}

/** ddmm.mmmm / dddmm.mmmm + hemisphere → signed decimal degrees. */
function parseLatLon(value: string, hemi: string): number {
  const num = Number(value)
  if (!Number.isFinite(num) || value === '') return NaN
  const deg = Math.floor(num / 100)
  const min = num - deg * 100
  let dd = deg + min / 60
  if (hemi === 'S' || hemi === 'W') dd = -dd
  return dd
}

/** "hhmmss.sss" → milliseconds within the day. */
function parseTimeMs(t: string): number {
  if (!t || t.length < 6) return NaN
  const hh = Number(t.slice(0, 2))
  const mm = Number(t.slice(2, 4))
  const ss = Number(t.slice(4)) // seconds + optional fraction
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return NaN
  return (hh * 3600 + mm * 60) * 1000 + Math.round(ss * 1000)
}

/**
 * Parse a RaceChrono / NMEA 0183 stream into a GPS track. Reads the active
 * $GxRMC sentences (validity 'A'), with checksum validation. This is the input
 * counterpart to Rc3NmeaExporter and the GPS source for the merge feature
 * (Phase 5) and multi-format analyzer input.
 */
export function parseNmea(text: string, maxTextChars: number = MAX_NMEA_TEXT_CHARS): NmeaData {
  if (text.length > maxTextChars) {
    throw new NmeaParseError(
      `refusing a ${text.length.toLocaleString()}-character file (limit ${maxTextChars.toLocaleString()})`,
    )
  }
  const fixes: NmeaFix[] = []
  let exportMetadata: ExportMetadata = {}
  const metadataChunks = new Map<number, string>()
  let metadataChunkCount = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('$') || !checksumOk(line)) continue
    const body = line.slice(1, line.lastIndexOf('*'))
    const f = body.split(',')
    const id = f[0]
    if (id === 'PTLS' && f[1] === 'META') {
      const index = Number(f[2])
      const count = Number(f[3])
      if (Number.isInteger(index) && index >= 1 && Number.isInteger(count) && count >= 1 && f[4]) {
        if (metadataChunkCount === 0 || metadataChunkCount === count) {
          metadataChunkCount = count
          metadataChunks.set(index, f[4])
        }
      }
      continue
    }
    if ((id === 'GPRMC' || id === 'GNRMC') && f[2] === 'A') {
      const lat = parseLatLon(f[3], f[4])
      const lon = parseLatLon(f[5], f[6])
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      fixes.push({
        timeMs: parseTimeMs(f[1]),
        lat,
        lon,
        speedKnots: Number(f[7]) || 0,
        course: Number(f[8]) || 0,
      })
    }
  }
  if (metadataChunkCount > 0 && metadataChunks.size === metadataChunkCount) {
    const payload = Array.from({ length: metadataChunkCount }, (_, index) => metadataChunks.get(index + 1) ?? '').join('')
    exportMetadata = decodeExportMetadata(payload)
  }
  return { fixes, exportMetadata }
}
