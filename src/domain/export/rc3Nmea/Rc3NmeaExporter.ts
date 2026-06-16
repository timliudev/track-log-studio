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

/** Format the created date as ddmmyy (local), defaulting to 010100. */
function formatDate(created: Date | null): string {
  if (!created) return '010100'
  const dd = padInt(created.getDate(), 2)
  const mm = padInt(created.getMonth() + 1, 2)
  const yy = padInt(created.getFullYear() % 100, 2)
  return `${dd}${mm}${yy}`
}

/**
 * Convert a parsed log to RaceChrono DIY .nmea: interleaved NMEA0183 $GPRMC
 * (when a GPS fix is present) and RaceChrono $RC3 sentences. Ported from
 * loga2nmea.py, with the analog/digital slots (d2, a1..a15) made configurable.
 *
 * Fixed slots are auto-filled and not user-selectable:
 *  - xacc/yacc/zacc from TC_Xforce/Yforce/Zforce / 1000 (G)
 *  - gyrox/y/z from TC_Xangle_dps/Yangle_dps/Zangle_dps (deg/s) when present
 *  - rpm/d1 from RPM
 *
 * Trailing empty slots are trimmed so the default `LEGACY_PY_MAPPING` (a1..a8
 * only) reproduces the Python golden output byte-for-byte.
 *
 * Two emission modes:
 *  - GPS (mixed NMEA): logs with GPS_Valid + GPS_UTC (Super2/SuperX) emit
 *    $GPRMC + $RC3, RC3's time field set and count empty, starting at the
 *    first valid fix (matches loga2nmea.py).
 *  - Standalone (no GPS): logs without GPS timing (RaceAMP/logger2) emit RC3
 *    only, with an empty time field and a populated overflowing count field, as
 *    the RaceChrono spec requires for GPS-less devices.
 */
export class Rc3NmeaExporter implements Exporter {
  readonly id = 'racechrono-rc3-nmea'
  readonly fileExtension = 'nmea'

  export(session: LogSession, mapping: Rc3Mapping = LEGACY_PY_MAPPING): string {
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

    // Fixed (auto) slots
    const cXf = arr('TC_Xforce')
    const cYf = arr('TC_Yforce')
    const cZf = arr('TC_Zforce')
    const cGx = arr('TC_Xangle_dps')
    const cGy = arr('TC_Yangle_dps')
    const cGz = arr('TC_Zangle_dps')
    const cRpm = arr('RPM')

    // Configurable slots, resolved once in SLOT_IDS order (d2, a1..a15).
    const slots = SLOT_IDS.map((id) => {
      const m = mapping[id]
      return {
        data: m.channel ? session.get(m.channel)?.data : undefined,
        decimals: m.decimals,
      }
    })

    // get with Python-like default of 0 for blank (NaN) cells of a present
    // channel; absent channels are handled at the slot level (emitted empty).
    const get = (a: Float32Array | undefined, row: number): number => {
      if (!a) return 0
      const v = a[row]
      return Number.isNaN(v) ? 0 : v
    }

    // GPS mixed mode requires both validity and UTC time channels.
    const gpsMode = cGpsValid !== undefined && cUtcHh !== undefined

    // Pass 1 (GPS mode only): collect valid fixes for heading smoothing.
    const valid = new Uint8Array(n)
    const fixIdx = new Int32Array(n).fill(-1)
    const fixLat: number[] = []
    const fixLon: number[] = []

    if (gpsMode) {
      for (let i = 0; i < n; i++) {
        const code = Math.trunc(get(cGpsValid, i))
        if (code !== 0 && String.fromCharCode(code) === 'A') {
          valid[i] = 1
          const latDeg = Math.trunc(get(cLatDeg, i))
          const latMin = get(cLatMin, i) + get(cLatMmmm, i) / 10000
          const latNs = String.fromCharCode(Math.trunc(get(cLatNs, i)))
          const lonDeg = Math.trunc(get(cLonDeg, i))
          const lonMin = get(cLonMin, i) + get(cLonMmmm, i) / 10000
          const lonEw = String.fromCharCode(Math.trunc(get(cLonEw, i)))
          let latDd = latDeg + latMin / 60
          if (latNs === 'S') latDd = -latDd
          let lonDd = lonDeg + lonMin / 60
          if (lonEw === 'W') lonDd = -lonDd
          fixIdx[i] = fixLat.length
          fixLat.push(latDd)
          fixLon.push(lonDd)
        }
      }
    }

    const courses = computeSmoothedCourses(fixLat, fixLon)
    const dateStr = formatDate(session.meta.createdDate)

    // Build one RC3 sentence for row i with the given time / count fields.
    const buildRc3 = (i: number, timeField: string, countField: string): string => {
      const xacc = get(cXf, i) / 1000
      const yacc = get(cYf, i) / 1000
      const zacc = get(cZf, i) / 1000
      const gx = cGx ? fmt(get(cGx, i), 3) : ''
      const gy = cGy ? fmt(get(cGy, i), 3) : ''
      const gz = cGz ? fmt(get(cGz, i), 3) : ''
      const rpm = get(cRpm, i)

      // d2, a1..a15 — empty when a slot is unmapped or its channel is absent.
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

    if (gpsMode) {
      // Mixed NMEA: GPRMC + RC3 (time set, count empty), from the first fix.
      let started = false
      for (let i = 0; i < n; i++) {
        let gprmc: string | null = null
        let timeStr = ''

        if (valid[i]) {
          started = true
          const hh = padInt(get(cUtcHh, i), 2)
          const mm = padInt(get(cUtcMm, i), 2)
          const ss = padInt(get(cUtcSs, i), 2)
          const ms = padInt(get(cUtcMs, i), 3)
          timeStr = `${hh}${mm}${ss}.${ms}`

          const latDeg = Math.trunc(get(cLatDeg, i))
          const latMin = get(cLatMin, i) + get(cLatMmmm, i) / 10000
          const latNs = String.fromCharCode(Math.trunc(get(cLatNs, i)))
          const lonDeg = Math.trunc(get(cLonDeg, i))
          const lonMin = get(cLonMin, i) + get(cLonMmmm, i) / 10000
          const lonEw = String.fromCharCode(Math.trunc(get(cLonEw, i)))

          const course = courses[fixIdx[i]]
          const speedKnots = get(cGpsSpeed, i) * 0.539957

          const gprmcBody =
            `GPRMC,${timeStr},A,` +
            `${padInt(latDeg, 2)}${fmtMin(latMin)},${latNs},` +
            `${padInt(lonDeg, 3)}${fmtMin(lonMin)},${lonEw},` +
            `${fmt(speedKnots, 2)},${fmt(course, 1)},${dateStr},,,A`
          gprmc = makeSentence(gprmcBody)
        } else if (!started) {
          continue // skip samples before the first GPS fix
        }

        if (gprmc) out.push(gprmc)
        out.push(buildRc3(i, valid[i] ? timeStr : '', ''))
      }
    } else {
      // Standalone: RC3 only, empty time, overflowing 0–65535 count.
      for (let i = 0; i < n; i++) {
        out.push(buildRc3(i, '', String(i % 65536)))
      }
    }

    return out.join('')
  }
}
