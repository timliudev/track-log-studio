import { describe, it, expect } from 'vitest'
import { parseVbo } from '@/domain/import/vbo/parseVbo'
import { vboImporter } from '@/domain/import/vbo/VboImporter'
import { detectImporter } from '@/domain/import/registry'

/**
 * Robustness / security tests for the VBO importer against UNTRUSTED, malformed
 * or malicious log files. The parser runs in a Web Worker that reports any
 * thrown Error as a clean "import failed" message, so the contract is:
 *  - structurally-invalid files throw a single, clear Error (no NaN-explosion,
 *    no unbounded work) — graceful failure;
 *  - merely *dirty* data (garbage cells, ragged rows) degrades to NaN without
 *    throwing, matching the Channel/LogaParser convention.
 */

/** Minimal well-formed VBO body builder for focused mutation in tests. */
function vbo(opts: {
  columns?: string
  data?: string[]
  header?: string[]
  omitColumns?: boolean
}): string {
  const lines: string[] = ['File created on 21/06/2026 at 16:25:24', '']
  lines.push('[header]')
  for (const h of opts.header ?? ['satellites', 'time', 'latitude', 'longitude']) {
    lines.push(h)
  }
  if (!opts.omitColumns) {
    lines.push('[column names]')
    lines.push(opts.columns ?? 'sats time lat long')
  }
  lines.push('[data]')
  for (const d of opts.data ?? ['8 162524.00 1350.000 -7290.000']) lines.push(d)
  return lines.join('\r\n')
}

describe('parseVbo robustness — structural failures throw a clear Error', () => {
  it('empty file throws (missing [column names])', () => {
    expect(() => parseVbo('')).toThrow(/column names/i)
  })

  it('whitespace-only file throws (missing [column names])', () => {
    expect(() => parseVbo('   \n\r\n  \t  \n')).toThrow(/column names/i)
  })

  it('missing [column names] section throws a clear error', () => {
    expect(() => parseVbo(vbo({ omitColumns: true }))).toThrow(/missing \[column names\]/i)
  })

  it('empty [column names] section (header/data present) throws', () => {
    const text = ['[header]', 'time', '[column names]', '', '[data]', '162524.0'].join('\n')
    expect(() => parseVbo(text)).toThrow(/column names/i)
  })

  it('a pathologically large grid is refused before allocation', () => {
    // 200k columns on one line × 4k tiny data rows ≈ 8e8 cells > MAX_GRID_CELLS,
    // yet the source text is only a few MB — the quadratic amplification case.
    const bigColLine = Array.from({ length: 200_000 }, (_, i) => `c${i}`).join(' ')
    const data = Array.from({ length: 4_000 }, () => '1')
    const text = ['[column names]', bigColLine, '[data]', ...data].join('\n')
    expect(() => parseVbo(text)).toThrow(/safety limit|grid/i)
  })

  // M9 P2 — a plain "simply huge" file (no quadratic column×row shape) still
  // paid the cost of `splitSections` fully materializing every line before
  // MAX_GRID_CELLS ever ran. `maxTextChars` lets the test exercise the new
  // raw-size cap at a tiny scale instead of building a 200 MB string.
  it('rejects an oversized file before splitting into sections (file-size cap)', () => {
    const text = vbo({ data: ['8 162524.00 1350.000 -7290.000'] })
    expect(() => parseVbo(text, 10)).toThrow(/refusing a [\d,]+-character file/)
  })

  it('still accepts a well-formed file at a reduced but sufficient cap', () => {
    const text = vbo({ data: ['8 162524.00 1350.000 -7290.000'] })
    const session = parseVbo(text, text.length)
    expect(session.rowCount).toBe(1)
  })
})

describe('parseVbo robustness — dirty data degrades to NaN, never throws', () => {
  it('missing [data] section yields an empty-but-valid session (no crash)', () => {
    const text = ['[column names]', 'sats time lat long', '[data]'].join('\n')
    const session = parseVbo(text)
    expect(session.meta.formatId).toBe('vbo')
    expect(session.rowCount).toBe(0)
  })

  it('a data row with too FEW columns → missing cells become NaN, no out-of-bounds', () => {
    // Row supplies only sats+time; lat/long are absent.
    const session = parseVbo(vbo({ data: ['8 162524.00'] }))
    expect(session.rowCount).toBe(1)
    const lat = session.get('GPS_Lat')!.data
    const lon = session.get('GPS_Lon')!.data
    expect(Number.isNaN(lat[0])).toBe(true)
    expect(Number.isNaN(lon[0])).toBe(true)
    // Present cells still parse.
    expect(session.get('Satellites')!.data[0]).toBe(8)
  })

  it('a data row with too MANY columns → extra trailing fields are ignored', () => {
    const session = parseVbo(vbo({ data: ['8 162524.00 1350.000 -7290.000 999 888 777'] }))
    expect(session.rowCount).toBe(1)
    // The 4 declared base columns parse correctly; extras are dropped silently.
    expect(session.get('Satellites')!.data[0]).toBe(8)
    expect(session.get('GPS_Lat')!.data[0]).toBeCloseTo(22.5, 5)
  })

  it('garbage numeric tokens become NaN (not a throw)', () => {
    const session = parseVbo(vbo({ data: ['oops 162524.00 NaN bogus'] }))
    expect(session.rowCount).toBe(1)
    expect(Number.isNaN(session.get('Satellites')!.data[0])).toBe(true)
    expect(Number.isNaN(session.get('GPS_Lat')!.data[0])).toBe(true)
  })

  it('malformed time token → NaN UTC parts and NaN elapsed, no throw', () => {
    const session = parseVbo(vbo({ data: ['8 not-a-time 1350.000 -7290.000'] }))
    expect(Number.isNaN(session.get('Time')!.data[0])).toBe(true)
    expect(Number.isNaN(session.get('GPS_UTC_hh')!.data[0])).toBe(true)
  })

  it('telemetry channels still align when a base column is absent from [column names]', () => {
    // No 'time'/'lat'/'long' columns at all — only sats + a telemetry channel.
    const text = ['[header]', 'satellites', 'RPM', '[column names]', 'sats RPM', '[data]', '8 6000', '8 6100'].join('\n')
    const session = parseVbo(text)
    expect(session.rowCount).toBe(2)
    const rpm = session.get('RPM')!.data
    expect(rpm[0]).toBe(6000)
    expect(rpm[1]).toBe(6100)
    // Absent GPS columns simply aren't emitted.
    expect(session.has('GPS_Lat')).toBe(false)
  })
})

describe('vboImporter.detect — detection ambiguity & ordering', () => {
  /** Build an ImportCandidate from a filename + headText (headBytes derived). */
  const cand = (fileName: string, headText: string) => ({
    fileName,
    headText,
    headBytes: new TextEncoder().encode(headText),
  })

  it('detects a real .vbo by filename even without [header] in the head', () => {
    expect(vboImporter.detect(cand('lap.vbo', ''))).toBe(true)
  })

  it('detects by [header] marker in content (extensionless name)', () => {
    expect(vboImporter.detect(cand('export', '[header]\ntime\n'))).toBe(true)
  })

  it('does NOT falsely detect an ordinary text file as VBO', () => {
    const txt = 'hello world\nthis is just a note\nno markers here\n'
    expect(vboImporter.detect(cand('notes.txt', txt))).toBe(false)
    // And the registry as a whole returns no importer for it.
    expect(detectImporter(cand('notes.txt', txt))).toBeUndefined()
  })

  it('a CSV-ish file that is not loga/nmea/vbo is not claimed by vbo', () => {
    const csv = 'a,b,c\n1,2,3\n4,5,6\n'
    expect(vboImporter.detect(cand('x.csv', csv))).toBe(false)
  })

  it('first-match-wins: a .loga file is not stolen by vbo even if it contained [header]-like text', () => {
    // .loga wins by extension regardless of body content.
    const imp = detectImporter(cand('log.loga', '[header]\n'))
    expect(imp?.id).toBe('loga')
  })
})
