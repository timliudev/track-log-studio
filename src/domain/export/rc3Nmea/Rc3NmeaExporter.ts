import type { Exporter } from '../Exporter'
import type { LogSession } from '@/domain/model/LogSession'
import { makeSentence } from '../nmeaChecksum'
import { computeSmoothedCourses } from './heading'

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
 * (when a GPS fix is present) and RaceChrono $RC3 sentences. Faithful port of
 * convert() in loga2nmea.py:
 *  - fixed acc/rpm channels; analog slots a1..a8 carry the default signal set
 *  - two passes: collect GPS fixes, smooth the heading, then emit
 *  - emission starts at the first valid fix; once started, RC3 keeps flowing
 *    even across brief fix dropouts (GPRMC is omitted for those samples)
 *
 * Channel mapping into RC3 analog slots (this is the default that Phase 1's UI
 * will later make configurable):
 *   a1=TPS_Percent a2=T_Eng a3=Vehicle_Speed a4=GPS_Speed
 *   a5=AFR a6=GearNum a7=TC_Lean_Angle a8=Volt_Batt
 */
export class Rc3NmeaExporter implements Exporter {
  readonly id = 'racechrono-rc3-nmea'
  readonly fileExtension = 'nmea'

  export(session: LogSession): string {
    const n = session.rowCount
    const arr = (name: string): Float32Array | undefined => session.get(name)?.data

    // Resolve channels once (alias-aware).
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

    const cXf = arr('TC_Xforce')
    const cYf = arr('TC_Yforce')
    const cZf = arr('TC_Zforce')
    const cRpm = arr('RPM')
    const cTps = arr('TPS_Percent')
    const cTEng = arr('T_Eng')
    const cVeh = arr('Vehicle_Speed')
    const cAfr = arr('AFR')
    const cGear = arr('GearNum')
    const cLean = arr('TC_Lean_Angle')
    const cVolt = arr('Volt_Batt')

    // get with Python-like default of 0 for missing column / blank (NaN) cell.
    const get = (a: Float32Array | undefined, row: number): number => {
      if (!a) return 0
      const v = a[row]
      return Number.isNaN(v) ? 0 : v
    }

    // Pass 1: collect valid GPS fixes for heading smoothing.
    const valid = new Uint8Array(n)
    const fixIdx = new Int32Array(n).fill(-1)
    const fixLat: number[] = []
    const fixLon: number[] = []

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

    const courses = computeSmoothedCourses(fixLat, fixLon)
    const dateStr = formatDate(session.meta.createdDate)

    // Pass 2: emit.
    const out: string[] = []
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
        // skip samples before the first GPS fix
        continue
      }

      if (!started) continue

      const xacc = get(cXf, i) / 1000
      const yacc = get(cYf, i) / 1000
      const zacc = get(cZf, i) / 1000
      const rpm = get(cRpm, i)
      const a1 = get(cTps, i)
      const a2 = get(cTEng, i)
      const a3 = get(cVeh, i)
      const a4 = get(cGpsSpeed, i)
      const a5 = get(cAfr, i)
      const a6 = get(cGear, i)
      const a7 = get(cLean, i)
      const a8 = get(cVolt, i)

      const rc3Time = valid[i] ? timeStr : ''
      const rc3Body =
        `RC3,${rc3Time},,` +
        `${fmt(xacc)},${fmt(yacc)},${fmt(zacc)},,,,` +
        `${fmt(rpm, 1)},,` +
        `${fmt(a1, 1)},${fmt(a2, 1)},${fmt(a3, 1)},${fmt(a4, 1)},` +
        `${fmt(a5, 2)},${fmt(a6, 0)},${fmt(a7, 2)},${fmt(a8, 2)}`
      const rc3 = makeSentence(rc3Body)

      if (gprmc) out.push(gprmc)
      out.push(rc3)
    }

    return out.join('')
  }
}
