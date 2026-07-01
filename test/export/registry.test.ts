import { describe, it, expect } from 'vitest'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { EXPORT_FORMATS, getExportFormat } from '@/domain/export/registry'
import { Rc3NmeaExporter } from '@/domain/export/rc3Nmea/Rc3NmeaExporter'
import { LEGACY_PY_MAPPING } from '@/domain/export/rc3Nmea/mapping'
import { convertToVbo } from '@/domain/export/vbo/VboExporter'
import { loadFixture } from '../fixtures'

describe('export registry — listing and lookup', () => {
  it('lists nmea and vbo formats', () => {
    expect(EXPORT_FORMATS.map((f) => f.id)).toEqual(['nmea', 'vbo'])
  })

  it('getExportFormat picks a format by id', () => {
    expect(getExportFormat('nmea')?.fileExtension).toBe('nmea')
    expect(getExportFormat('vbo')?.fileExtension).toBe('vbo')
  })

  it('getExportFormat returns undefined for an unknown id', () => {
    expect(getExportFormat('csv')).toBeUndefined()
  })
})

describe('export registry — dispatch produces the SAME bytes as calling the exporter directly', () => {
  const session = parseLoga(loadFixture('super2.loga'))

  it('nmea: registry dispatch matches Rc3NmeaExporter.export() byte-for-byte', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const direct = new Rc3NmeaExporter().export(session, LEGACY_PY_MAPPING, now)

    const format = getExportFormat('nmea')!
    const artifacts = format.exportSession(session, 'Super2.loga', { mapping: LEGACY_PY_MAPPING, now })

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].ext).toBe('nmea')
    expect(artifacts[0].suffix).toBe('')
    expect(artifacts[0].content).toBe(direct)
  })

  it('nmea: registry dispatch with default mapping matches the legacy golden path', () => {
    const direct = new Rc3NmeaExporter().export(session, LEGACY_PY_MAPPING)
    const format = getExportFormat('nmea')!
    // No mapping passed — the registry format must default to LEGACY_PY_MAPPING.
    const artifacts = format.exportSession(session, 'Super2.loga')
    // Compare everything except the synthesized "now" (both calls default to
    // `new Date()`, which is stable when there's a real UTC clock in the log).
    expect(artifacts[0].content).toBe(direct)
  })

  it('vbo: registry dispatch matches convertToVbo() byte-for-byte, including all 3 artifacts', () => {
    const vboSession = parseLoga(loadFixture('vbo.loga'))
    const now = new Date('2026-01-01T00:00:00Z')
    const direct = convertToVbo(vboSession, 'vbo.loga', now)

    const format = getExportFormat('vbo')!
    const artifacts = format.exportSession(vboSession, 'vbo.loga', { now })

    expect(artifacts).toHaveLength(3)
    expect(artifacts.map((a) => `${a.suffix}.${a.ext}`)).toEqual(['_ct.vbo', '_rc.vbo', '_channels.csv'])
    for (let i = 0; i < direct.length; i++) {
      expect(artifacts[i].content).toBe(direct[i].content)
    }
  })
})

describe('export registry — any imported format can export (not gated to loga)', () => {
  it('exports an NMEA-imported session back out to vbo via the registry', async () => {
    const { nmeaToSession } = await import('@/domain/import/nmea/NmeaImporter').then(
      (m) => ({ nmeaToSession: m.nmeaImporter.parse }),
    )
    const nmeaText = loadFixture('super2.expected.nmea')
    const session = await nmeaToSession(nmeaText)

    const format = getExportFormat('vbo')!
    const artifacts = format.exportSession(session, 'super2.expected.nmea')
    expect(artifacts.map((a) => `${a.suffix}.${a.ext}`)).toEqual(['_ct.vbo', '_rc.vbo', '_channels.csv'])
    expect(artifacts[0].content).toContain('[header]')
  })
})
