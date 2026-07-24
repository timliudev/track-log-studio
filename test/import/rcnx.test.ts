import { describe, it, expect, beforeAll } from 'vitest'
import { zipSync } from 'fflate'
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'
import { parseRcnx, listRcnxSessions } from '@/domain/import/rcnx/parseRcnx'
import { detectLapsByChannel } from '@/domain/analysis/laps'

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

/** A single synthetic sana lap row mirroring the sana_N.db `lap` table columns. */
interface SanaLapRow {
  startWp: number
  finishWp: number
  bFailed: boolean
}

/** Build a sana SQLite db (lap table only — enough for parseRcnx/listRcnxSessions). */
function buildSanaDb(laps: SanaLapRow[]): Uint8Array {
  const db: Database = new SQL.Database()
  db.run(
    'CREATE TABLE lap(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, bFailed boolean, ' +
      'start_wp INTEGER, start_inter_lat REAL, start_inter_lon REAL, ' +
      'finish_wp INTEGER, finish_inter_lat REAL, finish_inter_lon REAL, ' +
      'duration REAL, distance REAL, MaxSpd REAL, MinSpd REAL, AvgSpd REAL, ' +
      'MaxG REAL, MinG REAL, AvgG REAL)',
  )
  const stmt = db.prepare(
    'INSERT INTO lap(name, bFailed, start_wp, finish_wp, duration, distance) ' +
      "VALUES ('lap', ?, ?, ?, 0, 0)",
  )
  for (const l of laps) {
    stmt.run([l.bFailed ? 1 : 0, l.startWp, l.finishWp])
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

  it('opens an explicit sessionIndex, overriding the largest-session default', async () => {
    const sess0 = buildSessDb(makeRows(3, 1_554_608_573)) // fewer rows
    const sess1 = buildSessDb(makeRows(20, 1_556_346_856)) // more rows
    const rcnx = zipSync({
      'sess_0.db\0': sess0,
      'summary_0.txt\0': buildSummary({ sName: 'A', startTime: '1554608573' }),
      'sess_1.db\0': sess1,
      'summary_1.txt\0': buildSummary({ sName: 'B', startTime: '1556346856' }),
    })

    // Explicitly ask for session 0 (the smaller one) — must NOT fall back to 1.
    const session = await parseRcnx(rcnx, undefined, 0)
    expect(session.rowCount).toBe(3)
    expect(session.meta.headerInfo.sessionIndex).toBe('0')
    expect(session.meta.headerInfo.trackName).toBe('A')
  })

  it('throws for an out-of-range explicit sessionIndex', async () => {
    const sess0 = buildSessDb(makeRows(3, 1_554_608_573))
    const rcnx = zipSync({ 'sess_0.db\0': sess0 })
    await expect(parseRcnx(rcnx, undefined, 7)).rejects.toThrow(/sess_7\.db/)
  })
})

describe('listRcnxSessions', () => {
  it('enumerates all sessions with waypoint count, track name, and duration', async () => {
    const sess0 = buildSessDb(makeRows(3, 1_554_608_573))
    const sess1 = buildSessDb(makeRows(20, 1_556_346_856))
    const rcnx = zipSync({
      'sess_0.db\0': sess0,
      'summary_0.txt\0': buildSummary({ sName: 'A', startTime: '1554608573' }),
      'sess_1.db\0': sess1,
      'summary_1.txt\0': buildSummary({ sName: 'B', startTime: '1556346856' }),
    })

    const sessions = await listRcnxSessions(rcnx)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({ n: 0, waypointCount: 3, trackName: 'A', hasLapData: false })
    expect(sessions[1]).toMatchObject({ n: 1, waypointCount: 20, trackName: 'B', hasLapData: false })
    // 20 rows @ 100ms apart -> 1900ms span.
    expect(sessions[1].durationMs).toBeCloseTo(1900, 0)
  })

  it('returns a single-entry list for a single-session file', async () => {
    const sess0 = buildSessDb(makeRows(4, 1_556_346_856))
    const rcnx = zipSync({ 'sess_0.db\0': sess0 })
    const sessions = await listRcnxSessions(rcnx)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].n).toBe(0)
  })

  it('flags hasLapData true when the matching sana_N.db has lap rows', async () => {
    const sess0 = buildSessDb(makeRows(10, 1_556_346_856))
    const sana0 = buildSanaDb([
      { startWp: 1, finishWp: 5, bFailed: false },
      { startWp: 5, finishWp: 10, bFailed: false },
    ])
    const rcnx = zipSync({ 'sess_0.db\0': sess0, 'sana_0.db\0': sana0 })

    const sessions = await listRcnxSessions(rcnx)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].hasLapData).toBe(true)
  })
})

describe('parseRcnx — lap data from sana_N.db', () => {
  it('exposes sana lap boundaries as an IR_LapNumber channel usable by detectLapsByChannel', async () => {
    const rows = makeRows(12, 1_556_346_856)
    const sess0 = buildSessDb(rows)
    // WayPoints ids are 1-based (AUTOINCREMENT), so row i has id i+1.
    const sana0 = buildSanaDb([
      { startWp: 1, finishWp: 5, bFailed: false }, // rows 0..4
      { startWp: 5, finishWp: 9, bFailed: false }, // rows 4..8
      { startWp: 9, finishWp: 12, bFailed: true }, // rows 8..11 (in-lap)
    ])
    const rcnx = zipSync({ 'sess_0.db\0': sess0, 'sana_0.db\0': sana0 })

    const session = await parseRcnx(rcnx)
    const lapCh = session.get('IR_LapNumber')
    expect(lapCh).toBeDefined()
    expect(lapCh!.data.length).toBe(rows.length)
    // WayPoints id = row index + 1 (AUTOINCREMENT from 1). start_wp=1 is row
    // 0, so there's no pre-lap gap here; counter rises 0->1 at row 0.
    expect(lapCh!.data[0]).toBe(1)
    expect(lapCh!.data[4]).toBe(1)
    expect(lapCh!.data[5]).toBe(2)
    expect(lapCh!.data[8]).toBe(2)
    expect(lapCh!.data[9]).toBe(3)
    expect(lapCh!.data[11]).toBe(3)

    expect(session.meta.headerInfo.lapCount).toBe('3')
    expect(session.meta.headerInfo.validLapCount).toBe('2')

    // The existing ECU-lap-channel detector should pick these boundaries up
    // with zero analyzer changes. detectLapsByChannel only counts a boundary
    // where the counter RISES from a previously-seen value; the very first
    // sample never counts as a boundary (nothing to rise from), so 3 sana
    // laps starting exactly at row 0 give 2 rising edges (idx 5, idx 9) -> 1
    // lap between them. This is the "no tail" edge case: the last lap's
    // finish_wp (12) lands exactly on the final WayPoints row (rowCount=12),
    // so there are no trailing rows left to place a closing edge on for the
    // final lap — buildLapNumberChannel's out-lap tail is a no-op here, and
    // this assertion is unaffected by that fix. (See the "pre-lap gap" test
    // below for the case where the first lap's start_wp is NOT the first
    // row — there the initial 0->1 rise IS visible. See the "trailing rows"
    // test below for the normal case WITH a tail, where the final lap IS
    // now recovered.)
    const timeMs = Float64Array.from(session.timeChannel!.data)
    const laps = detectLapsByChannel(session, timeMs)
    expect(laps.length).toBe(1)
    expect(laps[0].startIdx).toBe(5)
    expect(laps[0].endIdx).toBe(9)
  })

  it('counts pre-lap (out-lap) rows as lap 0, and recovers the single lap via the post-finish tail edge', async () => {
    const rows = makeRows(10, 1_556_346_856)
    const sess0 = buildSessDb(rows)
    // First lap starts at wp id 4 (row 3), NOT row 0 — rows 0..2 are out-lap.
    // finish_wp=8 is row 7, leaving rows 8..9 as a 2-row post-lap tail.
    const sana0 = buildSanaDb([{ startWp: 4, finishWp: 8, bFailed: false }])
    const rcnx = zipSync({ 'sess_0.db\0': sess0, 'sana_0.db\0': sana0 })

    const session = await parseRcnx(rcnx)
    const lapCh = session.get('IR_LapNumber')!
    expect(lapCh.data[0]).toBe(0)
    expect(lapCh.data[2]).toBe(0)
    expect(lapCh.data[3]).toBe(1)
    expect(lapCh.data[7]).toBe(1)
    // Rows 8..9 are the post-finish out-lap tail: a distinct value one
    // greater than the lap's (2), not a continuation of lap 1.
    expect(lapCh.data[8]).toBe(2)
    expect(lapCh.data[9]).toBe(2)

    // The single sana lap now gives TWO rising edges: 0->1 at row 3 (its
    // start) and 1->2 at row 8 (the tail closing it) — enough for
    // detectLapsByChannel to recover the one official lap, matching the
    // sana lap-row count (1), instead of the old single-lap limit (0
    // detected laps) that a repeated-tail-value counter produced.
    const timeMs = Float64Array.from(session.timeChannel!.data)
    const laps = detectLapsByChannel(session, timeMs)
    expect(laps).toHaveLength(1)
    expect(laps[0]).toMatchObject({ startIdx: 3, endIdx: 8 })
  })

  it('recovers the final lap when trailing rows follow the last lap\'s finish_wp (regression, real 142.rcnx shape)', async () => {
    // Mirrors the real-world 142.rcnx shape: N official (sana) laps followed
    // by a substantial tail of post-finish rows (Qstarz keeps logging after
    // the finish line). Before the fix, buildLapNumberChannel's tail loop
    // repeated the last lap's counter value instead of incrementing it, so
    // the final lap had no closing rising edge and detectLapsByChannel
    // dropped it (N laps -> N-1 detected). This test asserts all N laps are
    // now recovered.
    const rowCount = 40
    const rows = makeRows(rowCount, 1_556_346_856)
    const sess0 = buildSessDb(rows)
    // WayPoints ids are 1-based (AUTOINCREMENT), so row i has id i+1.
    // Laps are contiguous (finish_k == start_{k+1}), as real Qstarz laps are:
    //   lap1: rows 3..8   (start_wp=4,  finish_wp=9)
    //   lap2: rows 8..14  (start_wp=9,  finish_wp=15)
    //   lap3: rows 14..20 (start_wp=15, finish_wp=21)
    // Rows 21..39 (19 rows, ~half the session) are the post-lap tail —
    // logged after lap3's finish_wp but with no further lap table entry.
    const officialLaps: SanaLapRow[] = [
      { startWp: 4, finishWp: 9, bFailed: false },
      { startWp: 9, finishWp: 15, bFailed: false },
      { startWp: 15, finishWp: 21, bFailed: false },
    ]
    const sana0 = buildSanaDb(officialLaps)
    const rcnx = zipSync({ 'sess_0.db\0': sess0, 'sana_0.db\0': sana0 })

    const session = await parseRcnx(rcnx)
    const lapCh = session.get('IR_LapNumber')!
    expect(lapCh).toBeDefined()
    expect(lapCh.data.length).toBe(rowCount)

    // Pre-lap rows (0..2) stay at lap 0.
    expect(lapCh.data[0]).toBe(0)
    expect(lapCh.data[2]).toBe(0)
    // The three official laps.
    expect(lapCh.data[3]).toBe(1)
    expect(lapCh.data[8]).toBe(1)
    expect(lapCh.data[9]).toBe(2)
    expect(lapCh.data[14]).toBe(2)
    expect(lapCh.data[15]).toBe(3)
    expect(lapCh.data[20]).toBe(3)
    // Tail rows (21..39) carry a distinct counter value ONE GREATER than the
    // last official lap's (3 + 1 = 4) — a separate out-lap, not a
    // continuation of lap 3.
    expect(lapCh.data[21]).toBe(4)
    expect(lapCh.data[39]).toBe(4)

    // meta.headerInfo.lapCount reports the official sana lap count.
    expect(session.meta.headerInfo.lapCount).toBe('3')
    expect(session.meta.headerInfo.validLapCount).toBe('3')

    // detectLapsByChannel must now recover ALL 3 official laps, not 2
    // (N-1). The tail's distinct value creates a 4th rising edge (at row
    // 21) that CLOSES lap 3, but produces no extra (4th) lap of its own,
    // since there is no further rising edge after it.
    const timeMs = Float64Array.from(session.timeChannel!.data)
    const laps = detectLapsByChannel(session, timeMs)
    expect(laps.length).toBe(3)
    expect(laps.length).toBe(officialLaps.length) // detected count == official lap-row count
    expect(laps[0]).toMatchObject({ startIdx: 3, endIdx: 9 })
    expect(laps[1]).toMatchObject({ startIdx: 9, endIdx: 15 })
    expect(laps[2]).toMatchObject({ startIdx: 15, endIdx: 21 })
  })

  it('has no IR_LapNumber channel when there is no matching sana_N.db', async () => {
    const sess0 = buildSessDb(makeRows(5, 1_556_346_856))
    const rcnx = zipSync({ 'sess_0.db\0': sess0 })
    const session = await parseRcnx(rcnx)
    expect(session.get('IR_LapNumber')).toBeUndefined()
    expect(session.meta.headerInfo.lapCount).toBeUndefined()
  })

  it('has no IR_LapNumber channel when sana_N.db has an empty lap table', async () => {
    const sess0 = buildSessDb(makeRows(5, 1_556_346_856))
    const sana0 = buildSanaDb([])
    const rcnx = zipSync({ 'sess_0.db\0': sess0, 'sana_0.db\0': sana0 })
    const session = await parseRcnx(rcnx)
    expect(session.get('IR_LapNumber')).toBeUndefined()
  })
})
