import { describe, it, expect } from 'vitest'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { Rc3NmeaExporter } from '@/domain/export/rc3Nmea/Rc3NmeaExporter'
import { LEGACY_PY_MAPPING } from '@/domain/export/rc3Nmea/mapping'
import { nmeaChecksum } from '@/domain/export/nmeaChecksum'
import { loadFixture } from '../fixtures'

describe('NMEA checksum', () => {
  it('matches the RaceChrono spec example', () => {
    // From https://racechrono.com/article/2572 — line ends with *2F
    const body =
      'RC3,,2,0.240,-0.560,-0.290,7.938,-0.125,0.063,,,7.063,-40.438,2.625,' +
      '70.875,9.875,-48.250,-6.360,-0.340,7.450,-6.100,-0.940,7.170,0,1,10'
    expect(nmeaChecksum(body)).toBe('2F')
  })
})

/** Split `$BODY*CS` into [body, checksum]. */
function splitSentence(line: string): [string, string] {
  const star = line.lastIndexOf('*')
  return [line.slice(1, star), line.slice(star + 1)]
}

/** Number of decimal places shown in a formatted field. */
function decimalsOf(s: string): number {
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}

/**
 * Largest legitimate difference for a field formatted to `expected`'s
 * precision: one unit in its last place (covers Python's round-half-to-even
 * vs JS round-half-away ties, and Float32-vs-double last-digit wobble).
 * Integer fields are exact passthroughs, so only allow sub-1 noise.
 */
function allowedDelta(expected: string): number {
  const decimals = decimalsOf(expected)
  return decimals === 0 ? 0.5 : Math.pow(10, -decimals) + 1e-9
}

interface FieldDiff {
  line: number
  field: number
  id: string
  actual: string
  expected: string
  delta: number
}

/**
 * Compare exporter output against the Python golden. GPS-derived fields are
 * integer-sourced and should match exactly; analog RC3 fields pass through
 * Float32 storage and may differ from Python's double in the last decimal, so
 * numeric fields are compared with a tolerance. Returns deviations above tol.
 */
function diffNmea(
  actual: string,
  expected: string,
): { diffs: FieldDiff[]; exactLines: number; total: number; maxDelta: number } {
  const a = actual.split('\r\n').filter((l) => l.length > 0)
  const e = expected.split(/\r?\n/).filter((l) => l.length > 0)
  expect(a.length).toBe(e.length)

  const diffs: FieldDiff[] = []
  let exactLines = 0
  let maxDelta = 0

  for (let i = 0; i < e.length; i++) {
    if (a[i] === e[i]) {
      exactLines++
      continue
    }
    const [aBody] = splitSentence(a[i])
    const [eBody] = splitSentence(e[i])
    const af = aBody.split(',')
    const ef = eBody.split(',')
    expect(af[0], `line ${i} sentence id`).toBe(ef[0])
    expect(af.length, `line ${i} field count`).toBe(ef.length)

    for (let f = 0; f < ef.length; f++) {
      if (af[f] === ef[f]) continue
      const an = Number(af[f])
      const en = Number(ef[f])
      if (af[f] !== '' && ef[f] !== '' && Number.isFinite(an) && Number.isFinite(en)) {
        const delta = Math.abs(an - en)
        if (delta > maxDelta) maxDelta = delta
        if (delta <= allowedDelta(ef[f])) continue
      }
      diffs.push({ line: i, field: f, id: ef[0], actual: af[f], expected: ef[f], delta: Math.abs(an - en) })
    }
  }
  return { diffs, exactLines, total: e.length, maxDelta }
}

describe('Rc3NmeaExporter vs Python golden', () => {
  const exporter = new Rc3NmeaExporter()

  for (const name of ['super2', 'superX'] as const) {
    it(`reproduces ${name}.expected.nmea`, () => {
      const session = parseLoga(loadFixture(`${name}.loga`))
      // Legacy mapping = the py field set; the regression anchor.
      const full = exporter.export(session, LEGACY_PY_MAPPING)

      // GGA is an addition over the Python reference; assert it was emitted
      // (one per fix) then compare only the GPRMC+RC3 lines to the golden.
      const lines = full.split('\r\n').filter((l) => l.length > 0)
      const ggaCount = lines.filter((l) => l.startsWith('$GPGGA')).length
      const rmcCount = lines.filter((l) => l.startsWith('$GPRMC')).length
      expect(ggaCount).toBeGreaterThan(0)
      expect(ggaCount).toBe(rmcCount)

      const output = lines.filter((l) => !l.startsWith('$GPGGA')).join('\r\n')
      const golden = loadFixture(`${name}.expected.nmea`)

      const { diffs, exactLines, total, maxDelta } = diffNmea(output, golden)

      // Diagnostics on the first run / on failure.
      // eslint-disable-next-line no-console
      console.log(
        `[${name}] exact lines ${exactLines}/${total}, max field delta ${maxDelta}`,
      )
      if (diffs.length > 0) {
        // eslint-disable-next-line no-console
        console.log(diffs.slice(0, 10))
      }

      expect(diffs).toEqual([])

      // every emitted sentence (incl. GGA) carries a self-consistent checksum
      for (const line of lines) {
        const star = line.lastIndexOf('*')
        expect(nmeaChecksum(line.slice(1, star))).toBe(line.slice(star + 1))
      }
    })
  }
})
