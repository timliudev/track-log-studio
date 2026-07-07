/**
 * Perf audit — compute pipeline bench (docs/PERF-AUDIT-2026-07-08.md, item 3
 * + item 5 memory). Benches the domain-layer functions behind each analyzer
 * card: GPS track extraction, lap detection (ECU channel + geometric line),
 * sector timing, corner detection, G-G scatter prep, suspension calibration
 * (synthetic — see note below), and the tire/wheel-circumference reverse-calc
 * (drivetrain log inversion). Each is a pure `domain/` function, so this
 * calls it directly with no Vue/Pinia/UI in the loop — isolates compute cost
 * from render cost (see bench-parse.ts for the parse step, and the report's
 * §4 for the render-side discussion, which isn't node-benchable).
 *
 * Rerun with:
 *   npx vite-node scripts/perf/bench-pipeline.ts
 * Point at real logs (never committed) via env vars — see _util.ts's
 * `loadFixture` doc for BENCH_SMALL_LOGA / BENCH_LARGE_LOGA.
 */
import { parseLoga } from '../../src/domain/parsing/LogaParser'
import { extractGpsTrack } from '../../src/domain/analysis/gpsTrack'
import { detectLapsByChannel, detectLapsByLine, type LapLine } from '../../src/domain/analysis/laps'
import { computeSectorTimes, computeOptimalLap } from '../../src/domain/analysis/sectorTiming'
import { detectCorners, cornerGateLine } from '../../src/domain/analysis/cornerDetection'
import { buildGgPoints } from '../../src/domain/analysis/ggData'
import { deriveSuspensionChannels, type SuspensionConfig } from '../../src/domain/units/suspension'
import { estimateCircumferenceFromLog } from '../../src/domain/analysis/drivetrain'
import { loadFixture, timeit, fmtMs, fmtBytes, fmtMem, section } from './_util'
import { LogSession } from '../../src/domain/model/LogSession'

const RUNS = 5

function timeSecondsToMs(session: LogSession): Float64Array {
  const time = session.timeChannel?.data
  const n = time?.length ?? 0
  const out = new Float64Array(n)
  if (!time) return out
  // aRacer .loga Timer channel is already milliseconds (see LogaParser doc /
  // fixtures) — mirrors useLaps.ts's timeSeconds()*1000 for a channel already
  // in seconds; here the sampled real logs carry a millisecond Timer column,
  // so this is a straight copy into Float64 (detectLapsByLine's expected type).
  for (let i = 0; i < n; i++) out[i] = time[i]
  return out
}

/** A synthetic gate line roughly bisecting the track's lat/lon bounding box —
 *  real gates are user-drawn against an actual track map, but for a PERF bench
 *  we only need a geometrically plausible line to exercise the same
 *  segment-intersection walk the real feature runs (see laps.ts's
 *  `walkLapGates`); correctness of the resulting lap/sector split doesn't
 *  matter here, only that the full O(n) pass over the track executes. */
function bboxBisectorLine(track: ReturnType<typeof extractGpsTrack>): LapLine | null {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  for (let i = 0; i < track.valid.length; i++) {
    if (!track.valid[i]) continue
    if (track.lat[i] < minLat) minLat = track.lat[i]
    if (track.lat[i] > maxLat) maxLat = track.lat[i]
    if (track.lon[i] < minLon) minLon = track.lon[i]
    if (track.lon[i] > maxLon) maxLon = track.lon[i]
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return null
  const midLat = (minLat + maxLat) / 2
  const midLon = (minLon + maxLon) / 2
  const dLat = (maxLat - minLat) || 0.0005
  return {
    a: { lat: midLat - dLat, lon: midLon },
    b: { lat: midLat + dLat, lon: midLon },
  }
}

for (const label of ['small', 'large'] as const) {
  const fixture = loadFixture(label)
  section(`${label} — ${fixture.path} (${fmtBytes(fixture.bytes)})`)

  const session = parseLoga(fixture.text)
  console.log(`rowCount=${session.rowCount} channels=${session.channels.length}`)

  // --- GPS track extraction (shared input for laps/sectors/corners) ---
  const trackStats = timeit(() => extractGpsTrack(session), RUNS)
  console.log(`extractGpsTrack: median=${fmtMs(trackStats.medianMs)}`)
  const track = extractGpsTrack(session)
  const timeMs = timeSecondsToMs(session)

  // --- Lap detection: ECU channel path ---
  const lapsByChannel = detectLapsByChannel(session, timeMs)
  const lapChannelStats = timeit(() => detectLapsByChannel(session, timeMs), RUNS)
  console.log(
    `detectLapsByChannel: median=${fmtMs(lapChannelStats.medianMs)} (found ${lapsByChannel.length} laps)`,
  )

  // --- Lap detection: geometric line path (bbox-bisector synthetic gate) ---
  const line = bboxBisectorLine(track)
  let lapsByLine: ReturnType<typeof detectLapsByLine> = []
  if (line) {
    lapsByLine = detectLapsByLine(track, timeMs, line)
    const lapLineStats = timeit(() => detectLapsByLine(track, timeMs, line), RUNS)
    console.log(
      `detectLapsByLine: median=${fmtMs(lapLineStats.medianMs)} (found ${lapsByLine.length} laps, synthetic bisector gate)`,
    )
  } else {
    console.log('detectLapsByLine: skipped (no GPS fix in this log)')
  }

  const laps = lapsByChannel.length >= 2 ? lapsByChannel : lapsByLine

  // --- Sector timing (2 synthetic gates + start/finish = 3 sectors) ---
  if (laps.length > 0 && line) {
    const gates = [line, line] // reuse the same gate twice — fine for a cost bench
    const sectorStats = timeit(() => computeSectorTimes(laps, track, timeMs, gates), RUNS)
    console.log(`computeSectorTimes (${laps.length} laps × ${gates.length} gates): median=${fmtMs(sectorStats.medianMs)}`)
    const timings = computeSectorTimes(laps, track, timeMs, gates)
    const optimalStats = timeit(() => computeOptimalLap(timings, []), RUNS)
    console.log(`computeOptimalLap: median=${fmtMs(optimalStats.medianMs)}`)
  } else {
    console.log('computeSectorTimes: skipped (no laps / no gate line)')
  }

  // --- Corner detection (whole track as one "reference lap" range) ---
  const cornerStats = timeit(() => detectCorners(session, track, 0, track.valid.length), RUNS)
  const corners = detectCorners(session, track, 0, track.valid.length)
  console.log(
    `detectCorners: median=${fmtMs(cornerStats.medianMs)} source=${corners.source} found=${corners.corners.length}`,
  )
  if (corners.corners.length > 0) {
    const gateStats = timeit(() => corners.corners.map((c) => cornerGateLine(track, c)), RUNS)
    console.log(`cornerGateLine ×${corners.corners.length}: median=${fmtMs(gateStats.medianMs)}`)
  }

  // --- G-G scatter prep (TC_Xforce/TC_Yforce -> decimated [x,y] points) ---
  const xCh = session.get('TC_Xforce')
  const yCh = session.get('TC_Yforce')
  if (xCh && yCh) {
    const ggFullStats = timeit(() => buildGgPoints(xCh.data, yCh.data, { scale: 0.001 }), RUNS)
    const ggDecStats = timeit(
      () => buildGgPoints(xCh.data, yCh.data, { scale: 0.001, maxPoints: 5000 }),
      RUNS,
    )
    console.log(
      `buildGgPoints (full, ${session.rowCount} samples): median=${fmtMs(ggFullStats.medianMs)}`,
    )
    console.log(`buildGgPoints (maxPoints=5000, actual UI path): median=${fmtMs(ggDecStats.medianMs)}`)
  } else {
    console.log('buildGgPoints: skipped (no TC_Xforce/TC_Yforce channel)')
  }

  // --- Suspension calibration derive — SYNTHETIC: neither sampled real log
  // carries SuspensionAD1/AD2 columns (motorcycle ECU logs without a
  // suspension pot wired up), so this reuses the RPM channel's raw values as
  // a stand-in "AD" source purely to exercise the O(n) linear-transform loop
  // (deriveSuspensionChannels/adToTravelMm) at this session's real length —
  // the transform's cost is elementwise and doesn't depend on which channel
  // feeds it, only on n. ---
  const adLike = session.get('RPM')
  if (adLike) {
    const fakeSession = new LogSession(
      [...session.channels, { ...adLike, name: 'SuspensionAD1', rawName: 'SuspensionAD1' }],
      session.meta,
    )
    const cfg: SuspensionConfig = {
      front: { enabled: true, sourceChannel: 'SuspensionAD1', minMv: 0, maxMv: 5000, zeroMv: 500, minMm: 0, maxMm: 120 },
      rear: { enabled: false, sourceChannel: 'SuspensionAD2', minMv: 0, maxMv: 5000, zeroMv: 500, minMm: 0, maxMm: 120 },
    }
    const suspStats = timeit(() => deriveSuspensionChannels(fakeSession, cfg), RUNS)
    console.log(`deriveSuspensionChannels (synthetic AD source, n=${session.rowCount}): median=${fmtMs(suspStats.medianMs)}`)
  }

  // --- Tire/wheel-circumference reverse-calc (drivetrain log inversion) ---
  const rpmCh = session.get('RPM')
  const speedCh = session.get('Vehicle_Speed') ?? session.get('Speed')
  if (rpmCh && speedCh) {
    // A plausible MT gear-reduction ladder (doesn't need to match the real
    // bike — the algorithm's cost is dominated by sample count + cluster
    // enumeration, not which reductions are supplied).
    const totalReductions = [12.5, 9.8, 7.9, 6.6, 5.7, 5.0]
    const circStats = timeit(
      () => estimateCircumferenceFromLog(rpmCh.data, speedCh.data, totalReductions),
      RUNS,
    )
    const estimate = estimateCircumferenceFromLog(rpmCh.data, speedCh.data, totalReductions)
    console.log(
      `estimateCircumferenceFromLog: median=${fmtMs(circStats.medianMs)} result=${estimate.circumferenceMm.toFixed(1)}mm (n=${estimate.sampleCount} qualifying samples)`,
    )
  } else {
    console.log('estimateCircumferenceFromLog: skipped (no RPM/Speed channel)')
  }

  console.log(`memory after full pipeline: ${fmtMem()}`)
  if (global.gc) {
    global.gc()
    console.log(`memory after forced GC: ${fmtMem()}`)
  } else {
    console.log('(run with `node --expose-gc` via vite-node to see post-GC memory)')
  }
}
