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
