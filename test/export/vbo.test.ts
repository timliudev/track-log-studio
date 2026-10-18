import { describe, it, expect } from 'vitest'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { convertToVbo } from '@/domain/export/vbo/VboExporter'
import { LogSession } from '@/domain/model/LogSession'
import { parseVbo } from '@/domain/import/vbo/parseVbo'
import { sessionStartAnchor } from '@/domain/analysis/startTime'
import { loadFixture } from '../fixtures'

/** Decimal places shown in a formatted field. */
function decimalsOf(s: string): number {
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}

/**
 * One ULP at the field's printed precision — covers Float32 storage vs Python's
 * double in the last decimal, and round-half-even vs round-half-away ties.
 * Integer fields are exact passthroughs (sub-1 noise only).
 */
function allowedDelta(expected: string): number {
  const decimals = decimalsOf(expected)
  return decimals === 0 ? 0.5 : Math.pow(10, -decimals) + 1e-9
}

interface LineDiff {
  line: number
  field?: number
  actual: string
  expected: string
}

/**
 * Compare a generated .vbo against the loga2vbo.py golden. GPS base fields are
 * integer-sourced and match exactly; [data] custom-channel fields pass through
 * Float32 and are compared with a per-field tolerance. The single attribution
 * line in [comments] intentionally differs (tool name) and is skipped.
 */
function diffVbo(actual: string, expected: string): LineDiff[] {
  const a = actual.split('\r\n')
  const e = expected.split('\r\n')
  expect(a.length, 'line count').toBe(e.length)

  const diffs: LineDiff[] = []
  let section = 'preamble'
  for (let i = 0; i < e.length; i++) {
    const el = e[i]
    if (el.startsWith('[')) section = el
    const al = a[i]
    if (al === el) continue
    if (el.startsWith('Converted from')) continue // attribution: tool name differs

    if (section === '[data]') {
      const af = al.split(' ')
      const ef = el.split(' ')
      if (af.length !== ef.length) {
        diffs.push({ line: i, actual: al, expected: el })
        continue
      }
      for (let f = 0; f < ef.length; f++) {
        if (af[f] === ef[f]) continue
        const an = Number(af[f])
        const en = Number(ef[f])
        if (Number.isFinite(an) && Number.isFinite(en) && Math.abs(an - en) <= allowedDelta(ef[f])) {
          continue
        }
        diffs.push({ line: i, field: f, actual: af[f], expected: ef[f] })
      }
    } else {
      diffs.push({ line: i, actual: al, expected: el })
    }
  }
  return diffs
}

describe('convertToVbo vs loga2vbo.py golden', () => {
  const session = parseLoga(loadFixture('vbo.loga'))
  const artifacts = convertToVbo(session, 'vbo.loga')
  const byExt = (suffix: string) => artifacts.find((a) => a.suffix === suffix)!

  it('produces _ct.vbo, _rc.vbo and _channels.csv', () => {
    expect(artifacts.map((a) => `${a.suffix}.${a.ext}`)).toEqual([
      '_ct.vbo',
      '_rc.vbo',
      '_channels.csv',
    ])
  })

  it('reproduces _ct.vbo (Circuit Tools, original ECU names)', () => {
    const diffs = diffVbo(byExt('_ct').content, loadFixture('vbo.expected_ct.vbo'))
    if (diffs.length) console.log(diffs.slice(0, 10))
    expect(diffs).toEqual([])
  })

  it('reproduces _rc.vbo (RaceChrono rc_ identifiers)', () => {
    const diffs = diffVbo(byExt('_rc').content, loadFixture('vbo.expected_rc.vbo'))
    if (diffs.length) console.log(diffs.slice(0, 10))
    expect(diffs).toEqual([])
  })

  it('reproduces the _channels.csv cross-reference byte-for-byte', () => {
    expect(byExt('_channels').content).toBe(loadFixture('vbo.expected_channels.csv'))
  })

  it('never emits a section-marker bracket inside [comments] (Circuit Tools hang)', () => {
    for (const suffix of ['_ct', '_rc'] as const) {
      const lines = byExt(suffix).content.split('\r\n')
      const start = lines.indexOf('[comments]') + 1
      let end = start
      while (end < lines.length && !lines[end].startsWith('[')) end++
      const offenders = lines.slice(start, end).filter((l) => /[[\]]/.test(l))
      expect(offenders, `${suffix} comment brackets`).toEqual([])
    }
  })

  it('VBO longitude convention is inverted vs decimal degrees (+long = West)', () => {
    // Taiwan is ~120°E, so the VBO longitude-minutes field must be negative.
    const data = byExt('_ct').content.split('\r\n')
    const dataStart = data.indexOf('[data]') + 1
    const longField = data[dataStart].split(' ')[3]
    expect(Number(longField)).toBeLessThan(0)
  })
})

describe('convertToVbo _channels.csv CSV-formula-injection guard', () => {
  // Security regression: a CVT tuning note round-tripped from an imported
  // file's TLS-Metadata is attacker-controllable text (see
  // domain/export/metadata.ts). _channels.csv writes note label/value as raw
  // cells (RFC 4180 quoted only) — a leading '=', '+', '-', '@', tab, or CR
  // must be neutralised with a leading `'`, or opening the file in Excel/
  // LibreOffice could evaluate it as a formula.
  const session = parseLoga(loadFixture('vbo.loga'))

  it('prefixes a leading formula-trigger character in a CVT note label/value', () => {
    const artifacts = convertToVbo(session, 'vbo.loga', new Date(), {
      cvtNotes: [
        { label: '=cmd|"/c calc"!A0', value: '+1+1' },
        { label: '-2+3', value: '@SUM(A1:A2)' },
        { label: 'Roller', value: 'plain text, unaffected' },
      ],
    })
    const csv = artifacts.find((a) => a.suffix === '_channels')!.content
    const noteLines = csv.split('\r\n').filter((l) => l.includes('cmd') || l.includes('SUM') || l.includes('Roller'))
    expect(noteLines).toContain(`"'=cmd|""/c calc""!A0",'+1+1`)
    expect(noteLines).toContain(`'-2+3,'@SUM(A1:A2)`)
    expect(noteLines).toContain('Roller,"plain text, unaffected"')
  })
})

describe('convertToVbo time source', () => {
  /** First data row's time field (HHMMSS.sss) from a _ct.vbo. */
  function firstTime(content: string): string {
    const lines = content.split('\r\n')
    return lines[lines.indexOf('[data]') + 1].split(' ')[1]
  }

  const pad = (v: number, w: number) => Math.trunc(v).toString().padStart(w, '0')

  it('uses GPS_UTC_hh/mm/ss/ms verbatim when the log carries a UTC clock', () => {
    const session = parseLoga(loadFixture('superX.loga'))
    const ct = convertToVbo(session, 'superX.loga').find((a) => a.suffix === '_ct')!.content

    const hh = session.get('GPS_UTC_hh')!.data
    const mm = session.get('GPS_UTC_mm')!.data
    const ss = session.get('GPS_UTC_ss')!.data
    const ms = session.get('GPS_UTC_ms')!.data
    const expected = `${pad(hh[0], 2)}${pad(mm[0], 2)}${pad(ss[0], 2)}.${pad(ms[0], 3)}`

    expect(firstTime(ct)).toBe(expected)
    // GPS_UTC columns are consumed, not re-emitted as telemetry channels.
    expect(ct).not.toContain('\r\nGPS_UTC_hh\r\n')
  })

  it('anchors a .loga without GPS_UTC at createdDate minus data duration, in UTC (b1(5), B139)', () => {
    // vbo.loga: created 16:25:24 local (+08, TZ pinned in vite.config); the last
    // row must land exactly on createdDate (readback) expressed in UTC.
    const session = parseLoga(loadFixture('vbo.loga'))
    const ct = convertToVbo(session, 'vbo.loga').find((a) => a.suffix === '_ct')!.content
    expect(firstTime(ct).startsWith('0825')).toBe(true)
    const lines = ct.split('\r\n')
    const lastTime = lines[lines.length - 2].split(' ')[1]
    expect(lastTime).toBe('082524.000') // = createdDate (readback) 16:25:24 +08 in UTC
  })

  it('B139: exports UTC time + header for createdDate 2026-10-09 16:53:05 (+08) with 1114.968 s of data', () => {
    const n = 3
    const time = new Float32Array([0, 557484, 1114968])
    const session = new LogSession(
      [
        { name: 'Time', rawName: 'Time', description: '', data: time },
        { name: 'RPM', rawName: 'RPM', description: '', data: new Float32Array([1, 2, 3]) },
      ],
      {
        formatId: 'raceAmp',
        createdDate: new Date(2026, 9, 9, 16, 53, 5),
        createdDateIsEnd: true,
        headerInfo: {},
      },
    )
    expect(session.rowCount).toBe(n)
    const ct = convertToVbo(session, 'x.loga').find((a) => a.suffix === '_ct')!.content
    expect(ct.split('\r\n')[0]).toBe('File created on 09/10/2026 at 08:34:30')
    const lines = ct.split('\r\n')
    const d = lines.indexOf('[data]')
    expect(lines[d + 1].split(' ')[1]).toBe('083430.032')
    expect(lines[d + 3].split(' ')[1]).toBe('085305.000')
  })

  it('B139: rolls the UTC day over correctly (local 02:00 +08 → previous UTC day 18:xx)', () => {
    const session = new LogSession(
      [
        { name: 'Time', rawName: 'Time', description: '', data: new Float32Array([0, 60000]) },
        { name: 'RPM', rawName: 'RPM', description: '', data: new Float32Array([1, 2]) },
      ],
      {
        formatId: 'raceAmp',
        createdDate: new Date(2026, 9, 10, 2, 0, 30),
        createdDateIsEnd: true,
        headerInfo: {},
      },
    )
    const ct = convertToVbo(session, 'x.loga').find((a) => a.suffix === '_ct')!.content
    expect(ct.split('\r\n')[0]).toBe('File created on 09/10/2026 at 17:59:30')
    expect(firstTime(ct)).toBe('175930.000')
  })

  it('B139: createdDate without createdDateIsEnd is the start (non-.loga sources)', () => {
    const session = new LogSession(
      [
        { name: 'Time', rawName: 'Time', description: '', data: new Float32Array([0, 60000]) },
        { name: 'RPM', rawName: 'RPM', description: '', data: new Float32Array([1, 2]) },
      ],
      { formatId: 'vbo', createdDate: new Date(2026, 9, 9, 16, 0, 0), headerInfo: {} },
    )
    const ct = convertToVbo(session, 'x.vbo').find((a) => a.suffix === '_ct')!.content
    expect(firstTime(ct)).toBe('080000.000')
  })

  describe('B139 round-trip: export → parseVbo keeps the start instant', () => {
    const mk = (created: Date, isEnd: boolean) =>
      new LogSession(
        [
          { name: 'Time', rawName: 'Time', description: '', data: new Float32Array([0, 557484, 1114968]) },
          { name: 'RPM', rawName: 'RPM', description: '', data: new Float32Array([1, 2, 3]) },
        ],
        { formatId: 'raceAmp', createdDate: created, createdDateIsEnd: isEnd, headerInfo: {} },
      )
    const roundTrip = (s: LogSession) => {
      const ct = convertToVbo(s, 'x.loga').find((a) => a.suffix === '_ct')!.content
      return parseVbo(ct)
    }

    it('b1(13)-like session: re-imported createdDate == exporter start == analysis anchor', () => {
      const s = mk(new Date(2026, 9, 9, 16, 53, 5), true)
      const startMs = new Date(2026, 9, 9, 16, 53, 5).getTime() - 1114968
      const back = roundTrip(s)
      expect(back.meta.createdDate!.getTime()).toBe(startMs)
      expect(sessionStartAnchor(s)!.startUtcMs).toBe(startMs)
    })

    it('survives a local-midnight crossing (local 02:00 → UTC previous day)', () => {
      const s = mk(new Date(2026, 9, 10, 2, 0, 30), true)
      const startMs = new Date(2026, 9, 10, 2, 0, 30).getTime() - 1114968
      expect(roundTrip(s).meta.createdDate!.getTime()).toBe(startMs)
    })

    it('third-party style: local-time header + UTC time column resolves to the real instant', () => {
      // Racelogic: header = PC local (+08) 16:34:30, time column = UTC 083430.
      const vbo = [
        'File created on 09/10/2026 at 16:34:30',
        '',
        '[column names]',
        'sats time lat long velocity heading height',
        '',
        '[data]',
        '008 083430.000 +1500.0 -7300.0 010.0 090.0 +00010.0',
        '008 083431.000 +1500.0 -7300.0 010.0 090.0 +00010.0',
        '',
      ].join(String.fromCharCode(13, 10))
      expect(parseVbo(vbo).meta.createdDate!.getTime()).toBe(Date.UTC(2026, 9, 9, 8, 34, 30))
    })
  })
})
