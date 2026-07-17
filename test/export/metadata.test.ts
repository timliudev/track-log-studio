import { describe, expect, it } from 'vitest'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { patchLogaText } from '@/domain/export/loga/LogaWriter'
import { getExportFormat } from '@/domain/export/registry'
import { nmeaToSession } from '@/domain/import/nmea/nmeaToSession'
import { parseVbo } from '@/domain/import/vbo/parseVbo'
import {
  decodeExportMetadata,
  encodeExportMetadata,
  exportMetadataFromHeader,
  type ExportMetadata,
} from '@/domain/export/metadata'
import { loadFixture } from '../fixtures'

const METADATA: ExportMetadata = {
  cvtNotes: [
    { label: '珠重', value: '12.5 g' },
    { label: '彈簧硬度', value: '黃彈簧，+15%' },
  ],
}

describe('portable CVT export metadata', () => {
  it('encodes Unicode notes into an ASCII-safe round-trip payload', () => {
    const payload = encodeExportMetadata(METADATA)
    expect(payload).not.toBeNull()
    expect(payload).toMatch(/^[\x20-\x7e]+$/)
    expect(decodeExportMetadata(payload)).toEqual(METADATA)
  })

  it('round-trips through a checksummed NMEA proprietary sentence', () => {
    const session = parseLoga(loadFixture('super2.loga'))
    const content = getExportFormat('nmea')!.exportSession(session, 'super2.loga', {
      metadata: METADATA,
      now: new Date('2026-01-01T00:00:00Z'),
    })[0].content
    const metadataSentences = content.split(/\r?\n/).filter((line) => line.startsWith('$PTLS,META,'))
    expect(metadataSentences.length).toBeGreaterThan(1)
    expect(metadataSentences.every((line) => line.length <= 82)).toBe(true)
    expect(metadataSentences[0]).toMatch(/^\$PTLS,META,1,\d+,.*\*[0-9A-F]{2}$/)
    const imported = nmeaToSession(content)
    expect(imported.meta.exportMetadata).toEqual(METADATA)

    const csv = getExportFormat('csv')!.exportSession(imported, 'roundtrip.nmea')[0].content
    expect(exportMetadataFromHeader(csv.split('\n')[0].split(',').at(-1)!)).toEqual(METADATA)
  })

  it('round-trips through the standard VBO comments section and annotates its map CSV', () => {
    const session = parseLoga(loadFixture('vbo.loga'))
    const artifacts = getExportFormat('vbo')!.exportSession(session, 'vbo.loga', { metadata: METADATA })
    const ct = artifacts.find((artifact) => artifact.suffix === '_ct')!
    const map = artifacts.find((artifact) => artifact.suffix === '_channels')!
    expect(ct.content).toContain('\r\nTLS-Metadata: ')
    expect(parseVbo(ct.content).meta.exportMetadata).toEqual(METADATA)
    expect(map.content).toContain('CVT 調教備註,值')
    expect(map.content).toContain('珠重,12.5 g')
  })

  it('stores metadata in a trailing, empty RFC 4180 CSV header column', () => {
    const session = parseLoga(loadFixture('super2.loga'))
    const content = getExportFormat('csv')!.exportSession(session, 'super2.loga', { metadata: METADATA })[0].content
    const lines = content.trimEnd().split('\n')
    const header = lines[0].split(',').at(-1)!
    expect(exportMetadataFromHeader(header)).toEqual(METADATA)
    expect(lines[1].endsWith(',')).toBe(true)
  })

  for (const fixture of ['super2.loga', 'superX.loga', 'raceAmp.loga', 'mxApp.loga']) {
    it(`round-trips ${fixture} metadata without adding a data row or visible channel`, () => {
      const original = loadFixture(fixture)
      const before = parseLoga(original)
      const patched = patchLogaText(original, new Map(), METADATA).text
      const after = parseLoga(patched)
      expect(after.rowCount).toBe(before.rowCount)
      expect(after.channels.map((channel) => channel.name)).toEqual(before.channels.map((channel) => channel.name))
      expect(after.meta.exportMetadata).toEqual(METADATA)
    })
  }

  it('replaces an existing .loga metadata header instead of appending a duplicate', () => {
    const original = loadFixture('super2.loga')
    const first = patchLogaText(original, new Map(), METADATA).text
    const updated: ExportMetadata = { cvtNotes: [{ label: '珠重', value: '13 g' }] }
    const second = patchLogaText(first, new Map(), updated).text
    expect((second.match(/TLS_Metadata\//g) ?? [])).toHaveLength(1)
    expect(parseLoga(second).meta.exportMetadata).toEqual(updated)
  })
})
