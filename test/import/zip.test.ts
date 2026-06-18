import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { extractLogFiles } from '@/domain/import/zip'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { loadFixture } from '../fixtures'

const dec = new TextDecoder()

describe('extractLogFiles', () => {
  it('pulls a .loga out of a zip (the app share export) and it parses', () => {
    const loga = loadFixture('mxApp.loga')
    const zip = zipSync({ '0515_1753_50.loga': strToU8(loga) })

    const logs = extractLogFiles(zip)
    expect(logs.length).toBe(1)
    expect(logs[0].name).toBe('0515_1753_50.loga')

    const session = parseLoga(dec.decode(logs[0].data))
    expect(session.meta.formatId).toBe('mxApp')
  })

  it('reduces nested paths to the base name and ignores non-log entries', () => {
    const zip = zipSync({
      'logs/run1.loga': strToU8('<aRacer MX APP Log File>\n'),
      'readme.txt': strToU8('ignore me'),
    })
    const logs = extractLogFiles(zip)
    expect(logs.map((l) => l.name)).toEqual(['run1.loga'])
  })

  it('returns an empty list for a zip with no log file', () => {
    const zip = zipSync({ 'notes.txt': strToU8('hello') })
    expect(extractLogFiles(zip)).toEqual([])
  })

  it('refuses to inflate beyond the uncompressed safety cap (zip-bomb guard)', () => {
    // 4 KB of log content with a 1 KB cap → the filter trips before inflating.
    const big = strToU8('x'.repeat(4096))
    const zip = zipSync({ 'huge.loga': big })
    expect(() => extractLogFiles(zip, 1024)).toThrow(/safety limit|zip bomb/)
  })
})
