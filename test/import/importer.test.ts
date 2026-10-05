import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectImporter, allImportExtensions } from '@/domain/import/registry'
import { IMPORT_FORMATS, extensionsForImporter } from '@/domain/import/formatDefinitions'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { nmeaToSession } from '@/domain/import/nmea/nmeaToSession'
import { parsePlainCsv } from '@/domain/import/csv/parsePlainCsv'
import { loadFixture } from '../fixtures'

/**
 * Everything here asserts against the SHIPPING import path, and only that.
 *
 * B88 split format handling in two: recognition lives in `IMPORT_FORMATS`
 * (`formatDefinitions.ts`, metadata only, part of the initial bundle) and
 * parsing lives in `WORKER_PARSERS` (`parse.worker.ts`, pulled in only after a
 * file is chosen). Until M20 seven `XxxImporter` objects also survived from the
 * pre-B88 single-object design, each re-declaring its `detect` predicate
 * verbatim — and these tests asserted against those COPIES. A regression in the
 * real `IMPORT_FORMATS.detect` therefore could not turn a test red. The copies
 * are deleted; every detect assertion below now runs the predicate the app runs.
 *
 * Parse assertions call the parser functions directly rather than importing
 * `parse.worker.ts`, because that module is a worker entry point: it touches the
 * `self` global and installs `onmessage` at module scope, which throws under
 * vitest's `environment: 'node'`. The id -> parser wiring it owns is covered
 * instead by the "WORKER_PARSERS 對齊" block, which reads the worker source and
 * cross-checks its keys against `IMPORT_FORMATS`.
 */

/** Build an ImportCandidate from a filename + headText (headBytes derived). */
function candidate(fileName: string, headText: string) {
  return { fileName, headText, headBytes: new TextEncoder().encode(headText) }
}

/** Build an ImportCandidate for a binary head (headText empty). */
function binaryCandidate(fileName: string, bytes: number[]) {
  return { fileName, headText: '', headBytes: Uint8Array.from(bytes) }
}

describe('detectImporter — first-match-wins over IMPORT_FORMATS', () => {
  const logaHead = loadFixture('super2.loga').slice(0, 4096)
  const gprmc = '$GPRMC,095409.300,A,2450.5554,N,12112.0367,E,30.78,24.1,190921,,,A*54\n'

  // One row per recognition rule the registry actually promises. `expected` is
  // the id of the format that must WIN — not merely "some format matched" — so
  // an ordering regression (a generic format stealing a specific one) fails too.
  const cases: ReadonlyArray<{
    readonly what: string
    readonly candidate: ReturnType<typeof candidate>
    readonly expected: string | undefined
  }> = [
    { what: 'loga by .loga extension', candidate: candidate('run01.loga', ''), expected: 'loga' },
    {
      what: 'loga by header content under a foreign name',
      candidate: candidate('mystery.txt', logaHead),
      expected: 'loga',
    },
    {
      what: 'loga by header content under a binary-looking name',
      candidate: candidate('unknown.bin', logaHead),
      expected: 'loga',
    },
    { what: 'nmea by .nmea extension', candidate: candidate('track.nmea', ''), expected: 'nmea' },
    {
      what: 'nmea by $GPRMC sentence',
      candidate: candidate('unknown.txt', gprmc),
      expected: 'nmea',
    },
    { what: 'vbo by .vbo extension', candidate: candidate('session.vbo', ''), expected: 'vbo' },
    {
      what: 'vbo by [header] marker',
      candidate: candidate('unknown.txt', '[header]\n'),
      expected: 'vbo',
    },
    {
      what: 'csv by .csv extension',
      candidate: candidate('telemetry.csv', 'Time,RPM\n0,1000\n'),
      expected: 'csv',
    },
    { what: 'rcz by .rcz extension', candidate: candidate('track.rcz', ''), expected: 'rcz' },
    { what: 'rcnx by .rcnx extension', candidate: candidate('track.rcnx', ''), expected: 'rcnx' },
    { what: 'xrk by .xrk extension', candidate: candidate('session.xrk', ''), expected: 'xrk' },
    { what: 'xrk by .xrz extension', candidate: candidate('session.xrz', ''), expected: 'xrk' },
    {
      what: 'xrk by <hCNF magic bytes',
      candidate: binaryCandidate('unknown.bin', [0x3c, 0x68, 0x43, 0x4e, 0x46]),
      expected: 'xrk',
    },
    {
      what: 'xrk by zlib magic bytes (a .xrz under a foreign name)',
      candidate: binaryCandidate('unknown.bin', [0x78, 0x9c]),
      expected: 'xrk',
    },
    {
      what: 'nothing for an ordinary text file',
      candidate: candidate('notes.txt', 'nothing recognised'),
      expected: undefined,
    },
    {
      what: 'nothing for a bare ZIP that is neither .rcz nor .rcnx',
      // Deliberate: `.rcz` / `.rcnx` are ZIPs, but bare `PK` magic must NOT be
      // claimed — plain .zip archives are unwrapped by zip.ts, not imported.
      candidate: binaryCandidate('archive.zip', [0x50, 0x4b, 0x03, 0x04]),
      expected: undefined,
    },
  ]

  for (const { what, candidate: value, expected } of cases) {
    it(`picks ${what}`, () => {
      expect(detectImporter(value)?.id).toBe(expected)
    })
  }

  it('a .loga file is not stolen by a later format even with [header] in the body', () => {
    expect(detectImporter(candidate('log.loga', '[header]\n'))?.id).toBe('loga')
  })
})

describe('IMPORT_FORMATS — registry shape', () => {
  it('registers exactly the expected ids and extensions, in priority order', () => {
    // Order is load-bearing: detectImporter is first-match-wins, so a format
    // matching only by a generic extension must never precede a specific one.
    expect(IMPORT_FORMATS.map(({ id, extensions }) => [id, [...extensions]])).toEqual([
      ['loga', ['loga']],
      ['nmea', ['nmea']],
      ['vbo', ['vbo']],
      ['csv', ['csv']],
      ['rcz', ['rcz']],
      ['rcnx', ['rcnx']],
      ['xrk', ['xrk', 'xrz']],
    ])
  })

  it('exposes no parse function — parsing must stay out of the initial bundle', () => {
    // B88's whole point: rendering FileBar must not drag every parser (and
    // their decompression / WASM dependencies) onto the initial route.
    for (const format of IMPORT_FORMATS) {
      expect(Object.keys(format).sort(), format.id).toEqual(['detect', 'extensions', 'id'])
    }
  })

  it('allImportExtensions lists every registered extension', () => {
    expect(allImportExtensions()).toEqual([
      'loga',
      'nmea',
      'vbo',
      'csv',
      'rcz',
      'rcnx',
      'xrk',
      'xrz',
    ])
  })

  it('extensionsForImporter resolves one id, and is empty for an unknown id', () => {
    expect(extensionsForImporter('xrk')).toEqual(['xrk', 'xrz'])
    expect(extensionsForImporter('loga')).toEqual(['loga'])
    expect(extensionsForImporter('nope')).toEqual([])
  })
})

describe('IMPORT_FORMATS 對齊 WORKER_PARSERS — 每個可辨識的格式都真的解析得動', () => {
  // The worker module cannot be imported here (see the file header), so its
  // dispatch table is read from source. If this regex ever stops matching, the
  // test fails loudly rather than silently covering nothing.
  const workerSource = readFileSync(
    new URL('../../src/workers/parse.worker.ts', import.meta.url),
    'utf8',
  )

  it('WORKER_PARSERS has exactly one entry per registered format id', () => {
    const block = workerSource.match(
      /const WORKER_PARSERS: Record<string, WorkerParser> = \{([\s\S]*?)\n\}/,
    )
    expect(block, 'WORKER_PARSERS object literal not found in parse.worker.ts').not.toBeNull()

    const keys = [...block![1].matchAll(/^ {2}([A-Za-z0-9_]+): \{/gm)].map((m) => m[1])
    expect(keys.length, 'no WORKER_PARSERS keys parsed — the regex has rotted').toBeGreaterThan(0)

    // Both directions: a format with no worker entry fails at import time with
    // "No worker parser for importer 'x'"; a worker entry with no format is an
    // orphan nothing can ever dispatch to.
    expect([...keys].sort()).toEqual([...IMPORT_FORMATS.map((f) => f.id)].sort())
  })
})

describe('worker parsers — the functions WORKER_PARSERS dispatches to', () => {
  it("loga: parseLoga turns a fixture into a LogSession with a 'super2' formatId", async () => {
    const session = await parseLoga(loadFixture('super2.loga'))
    expect(session.meta.formatId).toBe('super2')
    expect(session.has('RPM')).toBe(true)
    expect(session.rowCount).toBeGreaterThan(0)
  })

  it('nmea: nmeaToSession turns a fixture into an nmea LogSession', async () => {
    const session = await nmeaToSession(loadFixture('super2.expected.nmea'))
    expect(session.meta.formatId).toBe('nmea')
    expect(session.has('GPS_Lat')).toBe(true)
    expect(session.rowCount).toBeGreaterThan(0)
  })

  it('csv: parsePlainCsv parses a generic telemetry CSV', async () => {
    const session = await parsePlainCsv('Time,RPM\n0,1000\n')
    expect(session.meta.formatId).toBe('csv')
    expect(session.get('RPM')?.data[0]).toBe(1000)
  })
})
