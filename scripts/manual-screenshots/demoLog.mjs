// Synthetic demo log generator for the manual screenshots.
//
// The repo's real fixtures are 200-row stubs (no complete lap), which makes for
// empty-looking screenshots. This builds a plausible multi-lap circuit session
// as a plain CSV (the importer maps every header to a channel of that name, and
// needs exactly one Time/Timer column holding elapsed milliseconds).

const HZ = 20
const DT = 1 / HZ
const LAT0 = 24.79
const LON0 = 121.04
const M_PER_DEG_LAT = 111320

/** Deterministic PRNG so every re-run produces the identical log. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Circuit outline: a closed polygon of corner apex points (metres, local
 * east/north) whose corners are rounded into arcs below. Real straights
 * between real corners is what makes the speed trace, the braking zones and
 * the corner auto-detection behave like a genuine circuit — a smooth blob
 * gives neither.
 */
const CIRCUIT = [
  { p: [760, 0], r: 55 }, // T1 tight right (the main straight runs into it)
  { p: [960, 280], r: 130 }, // T2 fast sweeper
  { p: [790, 580], r: 70 },
  { p: [430, 610], r: 95 },
  { p: [300, 890], r: 45 }, // hairpin
  { p: [-70, 910], r: 80 },
  { p: [-280, 620], r: 60 },
  { p: [-110, 390], r: 40 }, // slow chicane apex
  { p: [-400, 170], r: 110 },
]

/** Round one polygon corner into a tangent arc; returns null for a straight. */
function fillet(prev, mid, next, radius) {
  if (radius <= 0) return null
  const v1 = [prev[0] - mid[0], prev[1] - mid[1]]
  const v2 = [next[0] - mid[0], next[1] - mid[1]]
  const l1 = Math.hypot(v1[0], v1[1])
  const l2 = Math.hypot(v2[0], v2[1])
  const u1 = [v1[0] / l1, v1[1] / l1]
  const u2 = [v2[0] / l2, v2[1] / l2]
  const phi = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])))
  if (!Number.isFinite(phi) || phi < 1e-6 || Math.PI - phi < 1e-6) return null
  let tangent = radius / Math.tan(phi / 2)
  const maxTangent = 0.45 * Math.min(l1, l2)
  if (tangent > maxTangent) tangent = maxTangent
  const r = tangent * Math.tan(phi / 2)
  const a = [mid[0] + u1[0] * tangent, mid[1] + u1[1] * tangent]
  const b = [mid[0] + u2[0] * tangent, mid[1] + u2[1] * tangent]
  const bis = [u1[0] + u2[0], u1[1] + u2[1]]
  const bl = Math.hypot(bis[0], bis[1]) || 1
  const centre = [
    mid[0] + (bis[0] / bl) * (r / Math.sin(phi / 2)),
    mid[1] + (bis[1] / bl) * (r / Math.sin(phi / 2)),
  ]
  return { a, b, centre, r }
}

/** Sample the centreline into {x, y, s, curvature} arrays (metres). */
function buildCentreline(stepM = 1.5) {
  const k = CIRCUIT.length
  const arcs = CIRCUIT.map((c, i) =>
    fillet(CIRCUIT[(i - 1 + k) % k].p, c.p, CIRCUIT[(i + 1) % k].p, c.r),
  )
  const pts = []
  const push = (px, py) => {
    const last = pts[pts.length - 1]
    if (!last || Math.hypot(px - last[0], py - last[1]) > 1e-6) pts.push([px, py])
  }
  for (let i = 0; i < k; i++) {
    const arc = arcs[i]
    const prevArc = arcs[(i - 1 + k) % k]
    const from = prevArc ? prevArc.b : CIRCUIT[(i - 1 + k) % k].p
    const to = arc ? arc.a : CIRCUIT[i].p
    // straight run into this corner
    const segLen = Math.hypot(to[0] - from[0], to[1] - from[1])
    const nStraight = Math.max(1, Math.round(segLen / stepM))
    for (let j = 0; j <= nStraight; j++) {
      const f = j / nStraight
      push(from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f)
    }
    if (!arc) continue
    // the corner arc itself
    const a0 = Math.atan2(arc.a[1] - arc.centre[1], arc.a[0] - arc.centre[0])
    let a1 = Math.atan2(arc.b[1] - arc.centre[1], arc.b[0] - arc.centre[0])
    let sweep = a1 - a0
    while (sweep > Math.PI) sweep -= Math.PI * 2
    while (sweep < -Math.PI) sweep += Math.PI * 2
    const nArc = Math.max(2, Math.round((Math.abs(sweep) * arc.r) / stepM))
    for (let j = 0; j <= nArc; j++) {
      const ang = a0 + (sweep * j) / nArc
      push(arc.centre[0] + arc.r * Math.cos(ang), arc.centre[1] + arc.r * Math.sin(ang))
    }
  }
  const n = pts.length
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = pts[i][0]
    y[i] = pts[i][1]
  }
  const s = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    s[i + 1] = s[i] + Math.hypot(x[j] - x[i], y[j] - y[i])
  }
  // Signed curvature from the three-point circumscribed circle.
  const kappa = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n
    const q = (i + 1) % n
    const ax = x[p] - x[i]
    const ay = y[p] - y[i]
    const bx = x[q] - x[i]
    const by = y[q] - y[i]
    const cross = ax * by - ay * bx
    const la = Math.hypot(ax, ay)
    const lb = Math.hypot(bx, by)
    const lc = Math.hypot(x[q] - x[p], y[q] - y[p])
    kappa[i] = la * lb * lc === 0 ? 0 : (2 * cross) / (la * lb * lc)
  }
  return { x, y, s, kappa, n, length: s[n] }
}

/** Steady-state speed profile: cornering limit, then accel/brake smoothing. */
function speedProfile(track, { aLat = 9.2, aAcc = 4.2, aBrake = 9.5, vMax = 47, vMin = 9 } = {}) {
  const { n, s, kappa } = track
  const v = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const r = Math.abs(kappa[i]) < 1e-9 ? Infinity : 1 / Math.abs(kappa[i])
    v[i] = Math.min(vMax, Math.max(vMin, Math.sqrt(aLat * r)))
  }
  const ds = (i) => Math.max(s[i + 1] - s[i], 1e-6)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * aAcc * ds(i)))
    }
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * aBrake * ds(i)))
    }
  }
  return v
}

/** Linear interpolation of a per-node quantity at distance `d` along the loop. */
function atDistance(track, arr, d) {
  const { s, n, length } = track
  let dd = d % length
  if (dd < 0) dd += length
  // binary search the segment
  let lo = 0
  let hi = n
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (s[mid] <= dd) lo = mid
    else hi = mid
  }
  const seg = Math.max(s[lo + 1] - s[lo], 1e-9)
  const f = (dd - s[lo]) / seg
  const a = arr[lo]
  const b = arr[(lo + 1) % n]
  return a + (b - a) * f
}

function posAtDistance(track, d) {
  return { x: atDistance(track, track.x, d), y: atDistance(track, track.y, d) }
}

const GEAR_RATIOS = [21.8, 15.4, 11.9, 9.7, 8.2, 7.5] // overall (engine rev per wheel rev)
const WHEEL_CIRC = 1.88 // m

/**
 * Build one session as CSV text.
 *
 * @param {object} opts
 * @param {number[]} opts.lapPace per-lap speed multiplier (length = lap count)
 * @param {number} opts.seed PRNG seed
 * @param {number} opts.headingOffsetDeg rotates the whole circuit (a second
 *        session recorded on the same track but stored slightly differently)
 */
export function buildDemoCsv({
  lapPace = [0.93, 0.965, 0.99, 1.0, 0.985, 0.96, 0.94],
  seed = 7,
  jitterM = 0.35,
} = {}) {
  const track = buildCentreline()
  const base = speedProfile(track)
  const rnd = mulberry32(seed)

  const rows = []
  let t
  // Start on the approach to the start/finish line (an out-lap already rolling)
  // so the very first fix is neither sitting on the line the analyzer seeds
  // there nor standing still: the seeded line is drawn perpendicular to the
  // heading of the first TWO fixes, and at a standstill that heading is pure
  // float32 GPS quantisation noise, which mis-orients the line and loses
  // most lap crossings.
  let dist = 250 // 250 m down the main straight (see the note on `v` below)
  // At full straight-line speed the first two fixes are ~2.4 m apart, which is
  // what the seeded start/finish line's heading estimate needs: float32 lat/lon
  // quantises to ~0.85 m, so a slow first pair yields a nonsense heading and a
  // mis-oriented line that then loses lap crossings.
  let v = atDistance(track, base, dist)
  let gear = 1
  let lap = -1
  // random-walk GPS noise so the trace looks recorded rather than drawn
  let nx = 0
  let ny = 0
  let tEng
  let vPrev = v

  const totalLaps = lapPace.length
  // Phases: hot laps -> in-lap to a stop -> parked -> standing-start launch ->
  // stop. The launch at the end is what gives the acceleration-test card a
  // real 0 km/h run to find.
  let phase = 'laps'
  let phaseT = 0
  let launchDist = 0

  for (let step = 0; ; step++) {
    t = step * DT
    const pace = lapPace[Math.min(Math.max(lap, 0), totalLaps - 1)]
    let vTarget
    if (phase === 'laps') vTarget = atDistance(track, base, dist) * pace
    else if (phase === 'launch') vTarget = atDistance(track, base, dist) * 0.9
    else vTarget = 0

    if (vTarget >= v) {
      v = Math.min(vTarget, v + 4.2 * DT)
    } else {
      v = Math.max(vTarget, v - 9.5 * DT)
    }
    const prevDist = dist
    dist += v * DT
    if (phase === 'laps' && Math.floor(dist / track.length) > lap) {
      lap = Math.floor(dist / track.length)
      if (lap >= totalLaps) {
        phase = 'inlap'
        phaseT = t
      }
    }
    if (phase === 'inlap' && v < 0.05 && t - phaseT > 2) {
      phase = 'parked'
      phaseT = t
    }
    if (phase === 'parked' && t - phaseT > 8) {
      phase = 'launch'
      phaseT = t
      launchDist = dist
    }
    // Stop the launch run short of the start/finish line: crossing it would
    // append a nonsense "lap" spanning the in-lap, the stop and the launch.
    if (phase === 'launch' && dist - launchDist > 115) {
      phase = 'stop'
    }
    if (phase === 'stop' && v < 0.05) break
    if (t > 1200) break

    const p = posAtDistance(track, dist)
    const ahead = posAtDistance(track, dist + 2)
    const behind = posAtDistance(track, dist - 2)
    const heading = (Math.atan2(ahead.x - behind.x, ahead.y - behind.y) * 180) / Math.PI
    const kappa = atDistance(track, track.kappa, dist)
    const aLat = -kappa * v * v // + = right-hand load
    const aLong = (v - vPrev) / DT
    vPrev = v

    nx = nx * 0.9 + (rnd() - 0.5) * jitterM
    ny = ny * 0.9 + (rnd() - 0.5) * jitterM

    // gear selection with rpm-based shift points
    const rpmIn = (g) => (v / WHEEL_CIRC) * 60 * GEAR_RATIOS[g]
    if (v < 1) gear = 0
    else {
      while (gear < GEAR_RATIOS.length - 1 && rpmIn(gear) > 11600) gear++
      while (gear > 0 && rpmIn(gear) < 5200) gear--
    }
    const rpm = v < 0.5 ? 1450 + rnd() * 60 : Math.max(1600, rpmIn(gear))
    const gearOut = v < 1 ? 0 : gear + 1

    const throttle =
      v < 0.5 ? 0 : aLong > 0.15 ? Math.min(100, 28 + 72 * (aLong / 4.2)) : aLong < -0.8 ? 0 : 22 + 14 * rnd()
    const brake = v < 0.5 ? 0 : (Math.max(0, -aLong) / 9.5) * 11

    tEng = 74 + 26 * (1 - Math.exp(-t / 150)) + 1.8 * Math.sin(t / 6.5)
    const afr = throttle > 60 ? 12.6 + 0.25 * rnd() : throttle > 5 ? 13.4 + 0.3 * rnd() : 14.6 + 0.4 * rnd()

    const lean = (Math.atan2(aLat, 9.81) * 180) / Math.PI
    // suspension pot voltages: dive under braking, squat on power, plus bumps
    const bump = Math.sin(dist / 3.1) * 0.05 + (rnd() - 0.5) * 0.03
    const susF = 2.55 - aLong * 0.11 + bump
    const susR = 2.45 + aLong * 0.09 + bump * 0.7

    // A slightly different racing line every lap. Besides being what a real
    // rider does, it keeps the trace off the EXACT same float32-quantised
    // coordinates lap after lap: a sample landing exactly on the seeded
    // start/finish line is an endpoint touch, which lap detection rejects, and
    // an identically repeated line makes that happen systematically.
    const lapPhase = Math.max(lap, 0)
    const lateral =
      0.9 * Math.sin(dist / 260 + lapPhase * 2.3) + (lapPhase % 3) * 0.55 - 0.55
    const tx = (ahead.x - behind.x) / (Math.hypot(ahead.x - behind.x, ahead.y - behind.y) || 1)
    const ty = (ahead.y - behind.y) / (Math.hypot(ahead.x - behind.x, ahead.y - behind.y) || 1)
    const east = p.x + nx - ty * lateral
    const north = p.y + ny + tx * lateral
    const lat = LAT0 + north / M_PER_DEG_LAT
    const lon = LON0 + east / (M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180))

    rows.push([
      Math.round(t * 1000),
      lat.toFixed(7),
      lon.toFixed(7),
      (v * 3.6).toFixed(2),
      ((heading + 360) % 360).toFixed(1),
      (118 + 9 * Math.sin((prevDist / track.length) * Math.PI * 2)).toFixed(1),
      Math.round(rpm),
      gearOut,
      throttle.toFixed(1),
      brake.toFixed(2),
      tEng.toFixed(1),
      (31 + 2 * rnd()).toFixed(1),
      afr.toFixed(2),
      (13.85 + 0.18 * Math.sin(t / 3)).toFixed(2),
      lean.toFixed(1),
      (aLat / 9.81).toFixed(3),
      (v < 0.5 ? 0 : aLong / 9.81).toFixed(3),
      susF.toFixed(3),
      susR.toFixed(3),
    ])
  }

  const header = [
    'Time',
    'GPS_Lat',
    'GPS_Lon',
    'GPS_Speed',
    'GPS_Course',
    'GPS_Alt',
    'RPM',
    'Gear',
    'TPS_Percent',
    'Brake_Bar',
    'T_Eng',
    'T_Air',
    'AFR',
    'Volt_Batt',
    'Lean_Angle',
    'Acc_Lat_G',
    'Acc_Long_G',
    'Sus_Front_V',
    'Sus_Rear_V',
  ]
  return header.join(',') + '\n' + rows.map((r) => r.join(',')).join('\n') + '\n'
}
