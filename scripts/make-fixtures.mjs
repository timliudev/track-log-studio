// Generate small .loga test fixtures from the large LogaExample/ files.
//
// Each fixture keeps the real header plus a window of data rows. For formats
// that carry GPS validity, the window starts just before the first valid fix
// so the exporter's "skip until first fix" path is exercised and the golden
// .nmea is non-trivial.
//
// Usage: node scripts/make-fixtures.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'test/fixtures')
mkdirSync(outDir, { recursive: true })

const WINDOW = 200
const LEAD_IN = 12 // rows before first GPS fix, to cover the skip path

/** @returns {{ namesLine: number, dataStart: number }} */
function structure(lines) {
  const first = lines[0].trim()
  if (first.startsWith('<Cycling Memory Log Data of Super ECU>')) {
    return { namesLine: 5, dataStart: 6 }
  }
  if (first.startsWith('<aRacerX Memory Log File>')) {
    let namesLine = -1
    let dataStart = -1
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim()
      if (t === '<VAR NAME>') namesLine = i + 1
      else if (t === '<DATA START>') {
        dataStart = i + 1
        break
      }
    }
    return { namesLine, dataStart }
  }
  if (first.startsWith('<aRacer ECU_Memory Log Data for RaceAMP>')) {
    const groupTokens = new Set(['Stage_1', 'Stage_2', 'Stage_3', 'Flag', ''])
    for (let i = 1; i < lines.length; i++) {
      const fields = lines[i].split(',')
      if (fields.length >= 2 && fields.every((f) => groupTokens.has(f.trim()))) {
        return { namesLine: i + 1, dataStart: i + 2 }
      }
    }
  }
  throw new Error(`Unknown format: ${first}`)
}

function canonical(raw) {
  const slash = raw.indexOf('/')
  return (slash === -1 ? raw : raw.slice(0, slash)).trim()
}

function makeFixture(srcPath, outName) {
  const text = readFileSync(srcPath, 'utf8')
  const lines = text.split(/\r?\n/)
  const { namesLine, dataStart } = structure(lines)

  const names = lines[namesLine].split(',').map(canonical)
  const gpsValidCol = names.indexOf('GPS_Valid')

  // find window start
  let start = dataStart
  if (gpsValidCol !== -1) {
    for (let i = dataStart; i < lines.length; i++) {
      if (lines[i].trim() === '') continue
      const f = lines[i].split(',')
      if (Number.parseInt(f[gpsValidCol], 10) === 65 /* 'A' */) {
        start = Math.max(dataStart, i - LEAD_IN)
        break
      }
    }
  } else {
    start = Math.floor((dataStart + lines.length) / 2)
  }

  const header = lines.slice(0, dataStart)
  const window = lines.slice(start, start + WINDOW).filter((l) => l.trim() !== '')
  const out = header.concat(window).join('\n') + '\n'
  const outPath = resolve(outDir, outName)
  writeFileSync(outPath, out, 'utf8')
  console.log(
    `${outName}: header=${header.length} rows=${window.length} gpsValidCol=${gpsValidCol} start=${start}`,
  )
}

makeFixture(resolve(root, 'LogaExample/Super2.loga'), 'super2.loga')
makeFixture(resolve(root, 'LogaExample/SuperX.loga'), 'superX.loga')
makeFixture(resolve(root, 'LogaExample/logger2.loga'), 'raceAmp.loga')
