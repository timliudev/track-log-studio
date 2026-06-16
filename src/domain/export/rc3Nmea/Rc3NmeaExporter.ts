import type { Exporter } from '../Exporter'
import type { LogSession } from '@/domain/model/LogSession'
import { makeSentence } from '../nmeaChecksum'
import { computeSmoothedCourses } from './heading'
import { SLOT_IDS, LEGACY_PY_MAPPING, type Rc3Mapping } from './mapping'

/** Format a number with fixed decimals (matches Python f"{v:.Nf}"). */
function fmt(v: number, decimals = 3): string {
  return v.toFixed(decimals)
}

/** Zero-padded integer of given width (truncates toward zero, like int()). */
function padInt(v: number, width: number): string {
  return Math.trunc(v).toString().padStart(width, '0')
}

/** GPS minutes as Python f"{v:07.4f}" — 4 decimals, zero-padded to width 7. */
function fmtMin(v: number): string {
  return v.toFixed(4).padStart(7, '0')
}

function ddmmyy(d: number, m: number, y: number): string {
  return `${padInt(d, 2)}${padInt(m + 1, 2)}${padInt(y % 100, 2)}`
}

/** A resolved GPS fix for one row. */
interface Fix {
  latDeg: number
  latMin: number
  latNs: string
  lonDeg: number
  lonMin: number
  lonEw: string
  latDd: number
  lonDd: number
}

/**
 * Convert a parsed log to RaceChrono DIY .nmea. Emits interleaved NMEA0183
 * $GPGGA + $GPRMC (whenever the log carries GPS position) and RaceChrono $RC3.
 * Ported from loga2nmea.py, with configurable analog/digital slots and broader
 * GPS handling than the original.
 *
 * Fixed RC3 slots are auto-filled and not user-selectable:
 *  - xacc/yacc/zacc from TC_Xforce/Yforce/Zforce / 1000 (G)
 *  - gyrox/y/z from TC_Xangle_dps/Yangle_dps/Zangle_dps (deg/s) when present
 *  - rpm/d1 from RPM
 *
 * GPS handling:
 *  - Real time (Super2/SuperX): GPS_Valid gates the first fix, GPS_UTC gives the
 *    time, Created Date gives the RMC date. RMC+RC3 reproduce loga2nmea.py
 *    (with GGA added on top).
 *  - Synthesized time (RaceAMP/logger2): has position but no validity/UTC, so a
 *    fix is any non-zero coordinate and timestamps are synthesized from `now`
 *    plus the log's elapsed Time column (preserves real intervals).
 *  - No position at all: RC3 only, empty time, overflowing 0–65535 count.
 *
 * In mixed-NMEA modes the RC3 time field is set and count is empty; standalone
 * uses the count field. Trailing empty slots are trimmed so LEGACY_PY_MAPPING
 * reproduces the Python golden output byte-for-byte (GGA lines aside).
 */
export class Rc3NmeaExporter implements Exporter {
  readonly id = 'racechrono-rc3-nmea'
  readonly fileExtension = 'nmea'

  export(
    session: LogSession,
    mapping: Rc3Mapping = LEGACY_PY_MAPPING,
    now: Date = new Date(),
  ): string {
    const n = session.rowCount
    const arr = (name: string): Float32Array | undefined => session.get(name)?.data

    // GPS channels
    const cGpsValid = arr('GPS_Valid')
    const cLatDeg = arr('GPS_Lat_deg')
    const cLatMin = arr('GPS_Lat_min')
    const cLatMmmm = arr('GPS_Lat_mmmm')
    const cLatNs = arr('GPS_Lat_NS')
    const cLonDeg = arr('GPS_Lon_deg')
    const cLonMin = arr('GPS_Lon_min')
    const cLonMmmm = arr('GPS_Lon_mmmm')
    const cLonEw = arr('GPS_Lon_EW')
    const cUtcHh = arr('GPS_UTC_hh')
    const cUtcMm = arr('GPS_UTC_mm')
    const cUtcSs = arr('GPS_UTC_ss')
    const cUtcMs = arr('GPS_UTC_ms')
    const cGpsSpeed = arr('GPS_Speed')
    const timeCh = session.timeChannel?.data

    // Fixed (auto) slots
    const cXf = arr('TC_Xforce')
    const cYf = arr('TC_Yforce')
    const cZf = arr('TC_Zforce')
    const cGx = arr('TC_Xangle_dps')
    const cGy = arr('TC_Yangle_dps')
    const cGz = arr('TC_Zangle_dps')
    const cRpm = arr('RPM')

    const slots = SLOT_IDS.map((id) => {
      const m = mapping[id]
      return {
        data: m.channel ? session.get(m.channel)?.data : undefined,
        decimals: m.decimals,
      }
    })

    const get = (a: Float32Array | undefined, row: number): number => {
      if (!a) return 0
      const v = a[row]
      return Number.isNaN(v) ? 0 : v
    }

    const hasValidity = cGpsValid !== undefined
    const hasUtc = cUtcHh !== undefined
    const hasPosition = cLatDeg !== undefined && cLonDeg !== undefined

    // Resolve a fix for row i, or null if the row has no valid fix.
    const fixAt = (i: number): Fix | null => {
      if (!hasPosition) return null
      const latDeg = Math.trunc(get(cLatDeg, i))
      const latMin = get(cLatMin, i) + get(cLatMmmm, i) / 10000
      const lonDeg = Math.trunc(get(cLonDeg, i))
      const lonMin = get(cLonMin, i) + get(cLonMmmm, i) / 10000

      let valid: boolean
      if (hasValidity) {
        const code = Math.trunc(get(cGpsValid, i))
        valid = code !== 0 && String.fromCharCode(code) === 'A'
      } else {
        // No validity flag: a non-zero coordinate means we have a fix.
        valid = latDeg !== 0 || latMin !== 0 || lonDeg !== 0 || lonMin !== 0
      }
      if (!valid) return null

      const latNs = cLatNs ? String.fromCharCode(Math.trunc(get(cLatNs, i))) : 'N'
      const lonEw = cLonEw ? String.fromCharCode(Math.trunc(get(cLonEw, i))) : 'E'
      let latDd = latDeg + latMin / 60
      if (latNs === 'S') latDd = -latDd
      let lonDd = lonDeg + lonMin / 60
      if (lonEw === 'W') lonDd = -lonDd
      return { latDeg, latMin, latNs, lonDeg, lonMin, lonEw, latDd, lonDd }
    }

    // Build one RC3 sentence for row i with the given time / count fields.
    const buildRc3 = (i: number, timeField: string, countField: string): string => {
      const xacc = get(cXf, i) / 1000
      const yacc = get(cYf, i) / 1000
      const zacc = get(cZf, i) / 1000
      const gx = cGx ? fmt(get(cGx, i), 3) : ''
      const gy = cGy ? fmt(get(cGy, i), 3) : ''
      const gz = cGz ? fmt(get(cGz, i), 3) : ''
      const rpm = get(cRpm, i)

      const slotFields = slots.map((s) =>
        s.data ? fmt(get(s.data, i), s.decimals) : '',
      )
      let end = slotFields.length
      while (end > 0 && slotFields[end - 1] === '') end--
      const slotStr = slotFields.slice(0, end).join(',')

      const body =
        `RC3,${timeField},${countField},` +
        `${fmt(xacc)},${fmt(yacc)},${fmt(zacc)},` +
        `${gx},${gy},${gz},` +
        `${fmt(rpm, 1)},` +
        slotStr
      return makeSentence(body)
    }

    const out: string[] = []

    // No GPS position at all → standalone RC3 with count field.
    if (!hasPosition) {
      for (let i = 0; i < n; i++) out.push(buildRc3(i, '', String(i % 65536)))
      return out.join('')
    }

    // GPS mode. Pass 1: collect fixes for heading smoothing.
    const fixIdx = new Int32Array(n).fill(-1)
    const fixes: (Fix | null)[] = new Array(n)
    const fixLat: number[] = []
    const fixLon: number[] = []
    let firstFixRow = -1
    for (let i = 0; i < n; i++) {
      const fix = fixAt(i)
      fixes[i] = fix
      if (fix) {
        if (firstFixRow === -1) firstFixRow = i
        fixIdx[i] = fixLat.length
        fixLat.push(fix.latDd)
        fixLon.push(fix.lonDd)
      }
    }
    const courses = computeSmoothedCourses(fixLat, fixLon)

    // Date + synthesized-time anchoring.
    const created = session.meta.createdDate
    const realDateStr = created
      ? ddmmyy(created.getDate(), created.getMonth(), created.getFullYear())
      : '010100'
    const synthDateStr = ddmmyy(now.getUTCDate(), now.getUTCMonth(), now.getUTCFullYear())
    const dateStr = hasUtc ? realDateStr : synthDateStr

    const stepMs = session.sampleIntervalMs ?? 100
    const t0 = firstFixRow >= 0 ? (timeCh ? timeCh[firstFixRow] : firstFixRow * stepMs) : 0
    const nowMs = now.getTime()

    const timeStrAt = (i: number): string => {
      if (hasUtc) {
        const hh = padInt(get(cUtcHh, i), 2)
        const mm = padInt(get(cUtcMm, i), 2)
        const ss = padInt(get(cUtcSs, i), 2)
        const ms = padInt(get(cUtcMs, i), 3)
        return `${hh}${mm}${ss}.${ms}`
      }
      const elapsed = (timeCh ? timeCh[i] : i * stepMs) - t0
      const d = new Date(nowMs + elapsed)
      return (
        padInt(d.getUTCHours(), 2) +
        padInt(d.getUTCMinutes(), 2) +
        padInt(d.getUTCSeconds(), 2) +
        '.' +
        padInt(d.getUTCMilliseconds(), 3)
      )
    }

    // Pass 2: emit GGA + RMC (at fixes) + RC3.
    let started = false
    for (let i = 0; i < n; i++) {
      const fix = fixes[i]
      let timeStr = ''

      if (fix) {
        started = true
        timeStr = timeStrAt(i)
        const course = courses[fixIdx[i]]
        const speedKnots = get(cGpsSpeed, i) * 0.539957
        const lat = `${padInt(fix.latDeg, 2)}${fmtMin(fix.latMin)}`
        const lon = `${padInt(fix.lonDeg, 3)}${fmtMin(fix.lonMin)}`

        const ggaBody =
          `GPGGA,${timeStr},${lat},${fix.latNs},${lon},${fix.lonEw},1,,,,M,,M,,`
        const rmcBody =
          `GPRMC,${timeStr},A,${lat},${fix.latNs},${lon},${fix.lonEw},` +
          `${fmt(speedKnots, 2)},${fmt(course, 1)},${dateStr},,,A`
        out.push(makeSentence(ggaBody))
        out.push(makeSentence(rmcBody))
      } else if (!started) {
        continue // skip samples before the first fix
      }

      // Mixed-NMEA mode: RC3 carries the time field, count stays empty.
      out.push(buildRc3(i, fix ? timeStr : '', ''))
    }

    return out.join('')
  }
}
