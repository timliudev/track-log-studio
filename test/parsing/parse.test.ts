import { describe, it, expect } from 'vitest'
import { parseLoga, UnknownLogaFormatError } from '@/domain/parsing/LogaParser'
import { canonicalName, descriptionOf } from '@/domain/parsing/canonical'
import { loadFixture } from '../fixtures'

describe('canonical naming', () => {
  it('splits Canonical/說明 on the first slash', () => {
    expect(canonicalName('RPM/引擎轉速')).toBe('RPM')
    expect(descriptionOf('RPM/引擎轉速')).toBe('引擎轉速')
  })
  it('keeps names without a slash and handles multi-slash descriptions', () => {
    expect(canonicalName('TPS_AD')).toBe('TPS_AD')
    expect(descriptionOf('TPS_AD')).toBeUndefined()
    // logger2 has 'GPS_Lat_NS/南/北緯' — only the first slash separates.
    expect(canonicalName('GPS_Lat_NS/南/北緯')).toBe('GPS_Lat_NS')
    expect(descriptionOf('GPS_Lat_NS/南/北緯')).toBe('南/北緯')
  })
})

describe('format detection', () => {
  it('throws a clear error on unknown headers', () => {
    expect(() => parseLoga('garbage\n1,2,3\n')).toThrow(UnknownLogaFormatError)
  })

  const cases = [
    { file: 'super2.loga', id: 'super2', interval: 62.5 },
    { file: 'superX.loga', id: 'superX', interval: 62.5 },
    { file: 'raceAmp.loga', id: 'raceAmp', interval: 31.25 },
    { file: 'mxApp.loga', id: 'mxApp', interval: 100 },
  ] as const

  for (const c of cases) {
    it(`parses ${c.file} as ${c.id}`, () => {
      const session = parseLoga(loadFixture(c.file))
      expect(session.meta.formatId).toBe(c.id)
      expect(session.rowCount).toBe(200)
      // every channel column has exactly rowCount samples
      for (const ch of session.channels) {
        expect(ch.data.length).toBe(session.rowCount)
      }
      // no empty trailing column survived ragged trailing commas
      expect(session.channels.every((ch) => ch.name.length > 0)).toBe(true)
      // sample rate derived from the time axis
      expect(session.sampleIntervalMs).toBeCloseTo(c.interval, 5)
    })
  }
})

describe('channel resolution', () => {
  it('resolves common channels and aliases', () => {
    const session = parseLoga(loadFixture('super2.loga'))
    expect(session.has('RPM')).toBe(true)
    // Super2 stores AFR as 'AFR_WBO2' and battery as 'Volt_Batt_indx';
    // alias lookup should still find them.
    expect(session.has('AFR')).toBe(true)
    expect(session.has('Volt_Batt')).toBe(true)
  })

  it('parses the created date', () => {
    const session = parseLoga(loadFixture('super2.loga'))
    expect(session.meta.createdDate?.getFullYear()).toBe(2021)
  })
})

describe('MX APP format', () => {
  it('parses the marker-based header and dashed created date', () => {
    const session = parseLoga(loadFixture('mxApp.loga'))
    expect(session.meta.formatId).toBe('mxApp')
    expect(session.has('RPM')).toBe(true)
    expect(session.has('Vehicle_Speed')).toBe(true)
    // "Created Date:2026-05-15 17:53:50"
    expect(session.meta.createdDate?.getFullYear()).toBe(2026)
    expect(session.meta.createdDate?.getMonth()).toBe(4) // May (0-based)
  })

  it('exposes decimal phone GPS as GPS_Lat/GPS_Lon via aliases', () => {
    const session = parseLoga(loadFixture('mxApp.loga'))
    expect(session.has('GPS_Lat')).toBe(true)
    expect(session.has('GPS_Lon')).toBe(true)
    expect(session.get('GPS_Lat')?.rawName).toBe('Phone_GPS_Latitude')
  })
})

describe('RaceAMP suspension support', () => {
  it('exposes the suspension AD channels (Phase 2 prerequisite)', () => {
    const session = parseLoga(loadFixture('raceAmp.loga'))
    expect(session.has('SuspensionAD1')).toBe(true)
    expect(session.has('SuspensionAD2')).toBe(true)
    expect(session.has('Front Suspension')).toBe(true)
    expect(session.has('Rear Suspension')).toBe(true)
    // The Chinese 上午/下午 created date parses.
    expect(session.meta.createdDate?.getFullYear()).toBe(2025)
  })
})
