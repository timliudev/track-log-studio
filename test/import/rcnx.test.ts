import { describe, it, expect, beforeAll } from 'vitest'
import { zipSync } from 'fflate'
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'
import { parseRcnx } from '@/domain/import/rcnx/parseRcnx'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs()
})

/** A single synthetic WayPoints row mirroring the sess_N.db schema columns. */
interface WayPointRow {
  time: number
  ms: number
  lat: number
  lon: number
  altitude: number
  heading: number
  speed: number
  Gx: number
  Gy: number
  Gz: number
  distance: number
}

/** Build a sess SQLite db (WayPoints + info) and export it as bytes. */
function buildSessDb(rows: WayPointRow[], model = 'LT-Q6000'): Uint8Array {
  const db: Database = new SQL.Database()
  db.run(
    'CREATE TABLE WayPoints(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, rcr char(1), time INTEGER, ms INTEGER, ' +
      'lat REAL, lon REAL, altitude REAL, heading REAL, speed REAL, ' +
      'Gx REAL, Gy REAL, Gz REAL, distance REAL, AccDec REAL, Inclination REAL)',
  )
  db.run('CREATE TABLE info (name text PRIMARY KEY NOT NULL, value text)')
  db.run("INSERT INTO info(name, value) VALUES ('model', ?)", [model])
  const stmt = db.prepare(
    'INSERT INTO WayPoints(rcr, time, ms, lat, lon, altitude, heading, speed, Gx, Gy, Gz, distance, AccDec, Inclination) ' +
      "VALUES ('T', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)",
  )
  for (const r of rows) {
    stmt.run([
      r.time, r.ms, r.lat, r.lon, r.altitude, r.heading, r.speed,
      r.Gx, r.Gy, r.Gz, r.distance,
    ])
  }
  stmt.free()
  const bytes = db.export()
  db.close()
  return bytes
}

/** Encode text as a bare UTF-16LE blob (no BOM needed for the decoder). */
function utf16le(text: string): Uint8Array {
  const buf = new Uint8Array(text.length * 2)
  const dv = new DataView(buf.buffer)
  for (let i = 0; i < text.length; i++) dv.setUint16(i * 2, text.charCodeAt(i), true)
  return buf
}

/** A summary_N.txt is alternating key-line / value-line text. */
function buildSummary(map: Record<string, string>): Uint8Array {
  const lines: string[] = []
  for (const [k, v] of Object.entries(map)) {
    lines.push(k, v)
  }
  return utf16le(lines.join('\n'))
}

function makeRows(n: number, startTime: number): WayPointRow[] {
  const rows: WayPointRow[] = []
  for (let i = 0; i < n; i++) {
    rows.push({
      time: startTime + Math.floor((i * 100) / 1000),
      ms: (i * 100) % 1000,
      lat: 23.1031 + i * 0.0001,
      lon: 120.2227 + i * 0.0001,
      altitude: 8 + i * 0.1,
      heading: 100 + i,
      speed: 40 + i,
      Gx: 0.3, Gy: 0.7, Gz: 1.8,
      distance: i * 0.001,
    })
  }
  return rows
}

describe('parseRcnx — synthetic sample', () => {
  it('parses a minimal synthetic .rcnx into an rcnx LogSession', async () => {
    const startTime = 1_556_346_856
    const rows = makeRows(4, startTime)
    const sess = buildSessDb(rows)
    const summary = buildSummary({
      sName: 'TWN-ARK',
      nHz: '10',
      startTime: String(startTime),
    })
    // Include a trailing-NUL entry name to verify the parser strips it.
    const rcnx = zipSync({
      'sess_0.db\0': sess,
      'summary_0.txt\0': summary,
    })

    const session = await parseRcnx(rcnx)

    expect(session.meta.formatId).toBe('rcnx')
    expect(session.rowCount).toBe(rows.length)

    const lat = session.get('GPS_Lat')!
    const lon = session.get('GPS_Lon')!
    expect(lat.data[0]).toBeCloseTo(23.1031, 4)
    expect(lon.data[0]).toBeCloseTo(120.2227, 4)
    expect(lon.data[0]).toBeGreaterThan(0)

    expect(session.get('GPS_Speed')).toBeDefined()
    expect(session.get('GPS_Speed')!.data[0]).toBeCloseTo(40, 3)

    // Time channel starts at 0.
    const time = session.timeChannel!
    expect(time.data[0]).toBe(0)
    expect(time.data[1]).toBeCloseTo(100, 3)

    // No Satellites channel from rcnx.
    expect(session.get('Satellites')).toBeUndefined()
  })

  it('reads summary + info metadata', async () => {
    const startTime = 1_556_346_856
    const sess = buildSessDb(makeRows(3, startTime), 'LT-Q6000')
    const summary = buildSummary({ sName: 'TWN-ARK', nHz: '10', startTime: String(startTime) })
    const rcnx = zipSync({ 'sess_0.db': sess, 'summary_0.txt': summary })

    const session = await parseRcnx(rcnx)
    expect(session.meta.createdDate!.getTime()).toBe(startTime * 1000)
    expect(session.meta.headerInfo.trackName).toBe('TWN-ARK')
    expect(session.meta.headerInfo.model).toBe('LT-Q6000')
    expect(session.meta.headerInfo.sampleRateHz).toBe('10')
    expect(session.meta.headerInfo.sessionCount).toBe('1')
    expect(session.meta.headerInfo.sessionIndex).toBe('0')
  })
})

describe('parseRcnx — multi-session selection', () => {
  it('picks the session with the most WayPoints (largest sess_N.db)', async () => {
    const sess0 = buildSessDb(makeRows(3, 1_554_608_573)) // fewer rows
    const sess1 = buildSessDb(makeRows(20, 1_556_346_856)) // more rows
    const rcnx = zipSync({
      'sess_0.db\0': sess0,
      'summary_0.txt\0': buildSummary({ sName: 'A', startTime: '1554608573' }),
      'sess_1.db\0': sess1,
      'summary_1.txt\0': buildSummary({ sName: 'B', startTime: '1556346856' }),
    })

    const session = await parseRcnx(rcnx)
    expect(session.rowCount).toBe(20)
    expect(session.meta.headerInfo.sessionCount).toBe('2')
    expect(session.meta.headerInfo.sessionIndex).toBe('1')
    expect(session.meta.headerInfo.trackName).toBe('B')
  })
})
