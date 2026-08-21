import { describe, it, expect } from 'vitest'
import { parseVbo } from '@/domain/import/vbo/parseVbo'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { convertToVbo } from '@/domain/export/vbo/VboExporter'
import { loadFixture } from '../fixtures'

describe('parseVbo fixtures', () => {
  for (const name of ['vbo.expected_ct.vbo', 'vbo.expected_rc.vbo']) {
    it(`parses ${name} into a vbo LogSession with plausible Taiwan coords`, () => {
      const session = parseVbo(loadFixture(name))
      expect(session.meta.formatId).toBe('vbo')
      expect(session.rowCount).toBeGreaterThan(0)

      const lat = session.get('GPS_Lat')
      const lon = session.get('GPS_Lon')
      expect(lat).toBeDefined()
      expect(lon).toBeDefined()

      // Taiwan: lat ~22-25 (N, positive), lon ~120-122 (E, positive).
      expect(lat!.data[0]).toBeGreaterThan(22)
      expect(lat!.data[0]).toBeLessThan(26)
      expect(lon!.data[0]).toBeGreaterThan(119)
      expect(lon!.data[0]).toBeLessThan(123)
    })
  }

  it('reads the created date from the preamble', () => {
    const session = parseVbo(loadFixture('vbo.expected_ct.vbo'))
    expect(session.meta.createdDate).not.toBeNull()
    // "File created on 21/06/2026 at 16:25:24"
    expect(session.meta.createdDate!.getFullYear()).toBe(2026)
    expect(session.meta.createdDate!.getMonth()).toBe(5) // June (0-based)
    expect(session.meta.createdDate!.getDate()).toBe(21)
  })

  it('keeps positional channel units, including a blank entry before a later unit', () => {
    const session = parseVbo([
      '[header]',
      'time',
      'first',
      'second',
      '',
      '[channel units]',
      's',
      '',
      'bar',
      '',
      '[column names]',
      'time first second',
      '',
      '[data]',
      '120000.000 1 2',
    ].join('\n'))
    expect(session.get('Time')?.unit).toBe('ms')
    expect(session.get('first')?.unit).toBeUndefined()
    expect(session.get('second')?.unit).toBe('bar')
  })

  it('B135: parses [session data] name and [laptiming] Start into meta', () => {
    const session = parseVbo(
      [
        '[header]',
        'time',
        '[channel units]',
        's',
        '[column names]',
        'time',
        '[data]',
        '120000.000 1',
        '',
        '[session data]',
        'name LihPao Full',
        '',
        '[laptiming]',
        'Start   -7241.186772 +1459.114540 -7241.175315 +1459.126888 ¬ Start/Finish',
      ].join('\n'),
    )

    expect(session.meta.sessionName).toBe('LihPao Full')
    expect(session.meta.startFinishLine).toBeDefined()
    const line = session.meta.startFinishLine!
    expect(line.a.lat).toBeCloseTo(24.31858, 5)
    expect(line.a.lon).toBeCloseTo(120.68645, 5)
    expect(line.b.lat).toBeCloseTo(24.31878, 5)
    expect(line.b.lon).toBeCloseTo(120.68626, 5)
  })

  it('B135: tolerates a [laptiming] section with only Split lines (no Start)', () => {
    const session = parseVbo(
      [
        '[column names]',
        'time',
        '[data]',
        '120000.000 1',
        '',
        '[laptiming]',
        'Split 1   -7241.1 +1459.1 -7241.1 +1459.1 ¬ Sector 1',
      ].join('\n'),
    )
    expect(session.meta.startFinishLine).toBeUndefined()
  })

  it('B135: sessionName and startFinishLine are undefined when the sections are absent', () => {
    const session = parseVbo(loadFixture('vbo.expected_ct.vbo'))
    expect(session.meta.sessionName).toBeUndefined()
    expect(session.meta.startFinishLine).toBeUndefined()
  })
})

describe('B136: name-suffix unit heuristic (fallback only)', () => {
  /** Build a minimal VBO with one telemetry column beyond the 7 base GPS
   *  columns, optionally with a `[channel units]` section. */
  function vboWithOneChannel(columnToken: string, unitsSection?: string[]): string {
    const lines = ['[header]', 'sats', 'time', 'lat', 'long', 'velocity', 'heading', 'height', columnToken]
    if (unitsSection) {
      lines.push('[channel units]', ...unitsSection)
    }
    lines.push(
      '[column names]',
      `sats time lat long velocity heading height ${columnToken}`,
      '[data]',
      '5 120000.000 1459.114540 -7241.186772 100 0 0 42',
    )
    return lines.join('\n')
  }

  it('fills the unit from a recognised suffix when [channel units] is absent entirely', () => {
    const session = parseVbo(vboWithOneChannel('EngineRPM_rpm'))
    const ch = session.get('EngineRPM_rpm')
    expect(ch).toBeDefined()
    expect(ch!.unit).toBe('rpm')
    // Name/rawName must be completely unchanged — B136 variant (a).
    expect(ch!.name).toBe('EngineRPM_rpm')
    expect(ch!.rawName).toBe('EngineRPM_rpm')
  })

  it.each([
    ['EngineRPM_rpm', 'rpm'],
    ['VehicleSpeed_kmh', 'km/h'],
    ['Something_kph', 'km/h'],
    ['Something_mph', 'mph'],
    ['Something_ms', 'm/s'],
    ['Something_mps', 'm/s'],
    ['CoolantTemp_degC', 'degC'],
    ['Something_degF', 'degF'],
    ['YawRate_degps', 'deg/s'],
    ['SteeringAngle_deg', 'deg'],
    ['IntakeManifoldPressure_kPa', 'kPa'],
    ['Something_bar', 'bar'],
    ['Something_psi', 'psi'],
    ['ThrottleDemand_pct', '%'],
    ['PhoneMagX_uT', 'µT'],
    ['Odometer_km', 'km'],
    ['Something_nm', 'Nm'],
    ['Something_hz', 'Hz'],
  ])('recognises suffix on %s → unit %s', (columnToken, expectedUnit) => {
    const session = parseVbo(vboWithOneChannel(columnToken))
    const ch = session.get(columnToken)
    expect(ch!.unit).toBe(expectedUnit)
  })

  it('case-insensitive on the suffix, but emits the conventional cased unit string', () => {
    const session = parseVbo(vboWithOneChannel('CoolantTemp_DEGC'))
    expect(session.get('CoolantTemp_DEGC')!.unit).toBe('degC')
  })

  describe('risky single-letter suffixes', () => {
    it.each([
      ['LateralAccel_g', 'g'],
      ['Odometer_m', 'm'],
      ['Elapsed_s', 's'],
      ['Battery_v', 'V'],
      ['Current_a', 'A'],
    ])('%s → %s', (columnToken, expectedUnit) => {
      const session = parseVbo(vboWithOneChannel(columnToken))
      expect(session.get(columnToken)!.unit).toBe(expectedUnit)
    })
  })

  it('an explicit [channel units] value always wins, even when the name also has a suffix', () => {
    const session = parseVbo(vboWithOneChannel('EngineRPM_rpm', ['count', 's', 'min', 'min', 'km/h', 'deg', 'm', 'raw']))
    // The 8th unit line ('raw') is positional for the 8th column (EngineRPM_rpm).
    expect(session.get('EngineRPM_rpm')!.unit).toBe('raw')
  })

  it('a blank positional [channel units] entry still falls back to the suffix heuristic', () => {
    const session = parseVbo(vboWithOneChannel('EngineRPM_rpm', ['count', 's', 'min', 'min', 'km/h', 'deg', 'm', '']))
    expect(session.get('EngineRPM_rpm')!.unit).toBe('rpm')
  })

  it('non-matching names are left with an undefined unit, not a false positive', () => {
    for (const name of ['CurrentGear', 'GearPRND', 'IgnitionState', 'DoorFL', 'NM_State_700']) {
      const session = parseVbo(vboWithOneChannel(name))
      expect(session.get(name)!.unit, `${name} unit`).toBeUndefined()
    }
  })

  it('a suffix embedded but not at the end, or not underscore-bounded, does not match', () => {
    // 'AcCompressorClutch_10Hz' from the real reference file: digit between
    // the underscore and 'Hz' breaks the boundary rule.
    const session = parseVbo(vboWithOneChannel('AcCompressorClutch_10Hz'))
    expect(session.get('AcCompressorClutch_10Hz')!.unit).toBeUndefined()
  })

  it('_deg does not also match _g (boundary rule prevents single-letter false split)', () => {
    const session = parseVbo(vboWithOneChannel('SteeringAngle_deg'))
    expect(session.get('SteeringAngle_deg')!.unit).toBe('deg')
  })
})

describe('VBO importer ⇄ exporter round-trip', () => {
  it('re-parsing the exporter output reproduces GPS + telemetry within epsilon', () => {
    const original = parseLoga(loadFixture('vbo.loga'))
    const vboText = convertToVbo(original, 'vbo.loga').find((a) => a.suffix === '_ct')!.content
    const reparsed = parseVbo(vboText)

    expect(reparsed.meta.formatId).toBe('vbo')
    expect(reparsed.rowCount).toBe(original.rowCount)

    // --- GPS coordinates (decimal degrees, epsilon ~1e-4) ---
    // The exporter derives decimal degrees from the integer deg/min/mmmm
    // encoding; rebuild the same reference here for comparison.
    const n = original.rowCount
    const latDeg = original.get('GPS_Lat_deg')!.data
    const latMin = original.get('GPS_Lat_min')!.data
    const latMmmm = original.get('GPS_Lat_mmmm')!.data
    const lonDeg = original.get('GPS_Lon_deg')!.data
    const lonMin = original.get('GPS_Lon_min')!.data
    const lonMmmm = original.get('GPS_Lon_mmmm')!.data

    const reLat = reparsed.get('GPS_Lat')!.data
    const reLon = reparsed.get('GPS_Lon')!.data

    const sampleIdx = [0, Math.floor(n / 2), n - 1]
    for (const i of sampleIdx) {
      const origLat = latDeg[i] + (latMin[i] + latMmmm[i] / 10000) / 60
      const origLon = lonDeg[i] + (lonMin[i] + lonMmmm[i] / 10000) / 60
      expect(Math.abs(reLat[i] - origLat)).toBeLessThan(1e-4)
      expect(Math.abs(reLon[i] - origLon)).toBeLessThan(1e-4)
    }

    // --- A couple of telemetry channels survive the round-trip ---
    for (const ch of ['RPM', 'AFR', 'TPS_Percent']) {
      const orig = original.get(ch)
      const re = reparsed.get(ch)
      expect(orig, `original has ${ch}`).toBeDefined()
      expect(re, `re-parsed has ${ch}`).toBeDefined()
      for (const i of sampleIdx) {
        // fmtNum prints up to 4 decimals; compare with a small epsilon.
        expect(Math.abs(re!.data[i] - orig!.data[i])).toBeLessThan(1e-3)
      }
    }
  })
})
