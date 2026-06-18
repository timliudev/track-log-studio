import { describe, it, expect } from 'vitest'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { Rc3NmeaExporter } from '@/domain/export/rc3Nmea/Rc3NmeaExporter'
import {
  DEFAULT_PRESET,
  LEGACY_PY_MAPPING,
  makeMapping,
} from '@/domain/export/rc3Nmea/mapping'
import { loadFixture } from '../fixtures'

const exporter = new Rc3NmeaExporter()

/** RC3 body fields of the first RC3 line, split on ','. */
function firstRc3Fields(nmea: string): string[] {
  const line = nmea.split('\r\n').find((l) => l.startsWith('$RC3'))!
  const star = line.lastIndexOf('*')
  return line.slice(1, star).split(',')
}

// RC3 field layout: RC3,time,count,xacc,yacc,zacc,gx,gy,gz,rpm,d2,a1,a2,...
const GYRO = { x: 6, y: 7, z: 8 }
const D2 = 10
const A1 = 11

describe('configurable RC3 slot mapping', () => {
  it('legacy mapping trims trailing empties to a8 and leaves d2/gyro empty (Super2)', () => {
    const session = parseLoga(loadFixture('super2.loga'))
    const fields = firstRc3Fields(exporter.export(session, LEGACY_PY_MAPPING))
    expect(fields[GYRO.x]).toBe('') // Super2 has no angle_dps channels
    expect(fields[D2]).toBe('') // d2 unmapped in legacy
    expect(fields[A1]).not.toBe('') // a1 = TPS_Percent
    // last field is a8; there is no a9 (index A1 + 8 = 19) → trimmed
    expect(fields.length).toBe(A1 + 8)
  })

  it('auto-fills gyro from angle_dps and maps default slots (RaceAMP)', () => {
    const session = parseLoga(loadFixture('raceAmp.loga'))
    const fields = firstRc3Fields(exporter.export(session, DEFAULT_PRESET))
    // RaceAMP carries TC_*angle_dps → gyro filled
    expect(Number.isFinite(Number(fields[GYRO.x]))).toBe(true)
    expect(fields[GYRO.x]).not.toBe('')
    // d2 mapped to TPS_Percent in the default preset
    expect(fields[D2]).not.toBe('')
  })

  it('synthesizes GGA+RMC for RaceAMP (position but no GPS time)', () => {
    const session = parseLoga(loadFixture('raceAmp.loga'))
    const now = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 0))
    const lines = exporter
      .export(session, DEFAULT_PRESET, now)
      .split('\r\n')
      .filter((l) => l.length > 0)

    const gga = lines.filter((l) => l.startsWith('$GPGGA'))
    const rmc = lines.filter((l) => l.startsWith('$GPRMC'))
    expect(gga.length).toBeGreaterThan(0)
    expect(gga.length).toBe(rmc.length)
    // First fix is anchored at `now` (UTC 03:04:05.000).
    expect(rmc[0]).toContain('030405.000')
  })

  it('emits empty accel when the IMU columns are absent', () => {
    // RaceAMP log without any TC_*force columns (no Race Module IMU).
    const text = [
      '<aRacer ECU_Memory Log Data for RaceAMP>',
      'Created Date:2025/4/20 下午 05:21:15',
      'Product ID = 0xA6',
      'Serial Number = X',
      'Stage_1,Stage_1',
      'Time,RPM/r',
      '31.25,1000',
      '62.5,2000',
    ].join('\n')
    const fields = firstRc3Fields(exporter.export(parseLoga(text)))
    // xacc,yacc,zacc (indices 3,4,5) all empty, not "0.000"
    expect(fields[3]).toBe('')
    expect(fields[4]).toBe('')
    expect(fields[5]).toBe('')
  })

  it('emits empty for a mapped-but-absent channel', () => {
    const session = parseLoga(loadFixture('super2.loga'))
    const mapping = makeMapping({
      a1: { channel: 'NoSuchChannel', decimals: 1 },
      a2: { channel: 'RPM', decimals: 0 },
    })
    const fields = firstRc3Fields(exporter.export(session, mapping))
    expect(fields[A1]).toBe('') // absent channel → empty
    expect(fields[A1 + 1]).not.toBe('') // a2 = RPM present
  })
})
