import { describe, it, expect } from 'vitest'
import {
  detectCornersByCurvature,
  curvatureSignal,
  cornerGateLine,
  pickReferenceLap,
  CURVATURE_DEFAULTS,
} from '@/domain/analysis/cornerDetection'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'
import { haversineM } from '@/domain/export/rc3Nmea/geo'
import { planarGate, walkLapGates } from '@/domain/analysis/laps'

// These tests exercise the peak-separation ALGORITHM on synthetic (low-noise)
// signals, so they pass lenient, explicit thresholds rather than relying on
// CURVATURE_DEFAULTS — those defaults are calibrated separately against real,
// noisy GPS data (see cornerDetection.ts) and are a different concern (how
// permissive a floor real-world data needs) from "does peak+prominence+spacing
// correctly separate corners" (what these tests check).
const LENIENT = { minValue: 0.25, minProminence: 0.15 }

const R = 6371000
const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

/**
 * Synthesize a GPS track by walking forward `stepM` metres per sample, turning
 * by `turnRatesDegPerStep[k]` degrees between sample k and k+1 (equirectangular
 * approximation — accurate enough at track scale for a synthetic test).
 * Produces turnRatesDegPerStep.length + 1 points.
 */
function walkTrack(turnRatesDegPerStep: number[], stepM = 5, lat0 = 23, lon0 = 120): GpsTrack {
  const n = turnRatesDegPerStep.length + 1
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  lat[0] = lat0
  lon[0] = lon0
  let heading = 90 // start heading east; arbitrary
  for (let k = 0; k < turnRatesDegPerStep.length; k++) {
    const dLat = toDeg((stepM * Math.cos(toRad(heading))) / R)
    const dLon = toDeg((stepM * Math.sin(toRad(heading))) / (R * Math.cos(toRad(lat[k]))))
    lat[k + 1] = lat[k] + dLat
    lon[k + 1] = lon[k] + dLon
    heading += turnRatesDegPerStep[k]
  }
  return { lat, lon, valid: new Uint8Array(n).fill(1) }
}

/** Build a turn-rate profile: `straight` flat samples, then a triangular ramp
 *  0 -> peak -> 0 over `rampSteps`, then `straight` flat samples again. */
function singleHump(straight: number, rampSteps: number, peak: number): number[] {
  const out: number[] = new Array(straight).fill(0)
  const half = rampSteps / 2
  for (let i = 0; i < rampSteps; i++) {
    const t = i < half ? i / half : (rampSteps - i) / half
    out.push(peak * t)
  }
  out.push(...new Array(straight).fill(0))
  return out
}

describe('curvatureSignal + detectCornersByCurvature (feasibility spike)', () => {
  it('finds no corners on a straight line', () => {
    const track = walkTrack(new Array(60).fill(0))
    const corners = detectCornersByCurvature(track, 0, track.valid.length, LENIENT)
    expect(corners).toHaveLength(0)
  })

  it('finds exactly one corner at a single 90-degree turn', () => {
    const turnRates = singleHump(20, 20, 9) // 20 steps ramping 0->9->0 deg/step, total turn ~90deg
    const track = walkTrack(turnRates)
    const corners = detectCornersByCurvature(track, 0, track.valid.length, LENIENT)
    expect(corners).toHaveLength(1)
  })

  it('separates a chicane (opposite-direction turns) into two corners', () => {
    const left = singleHump(15, 14, 8)
    const right = singleHump(15, 14, -8).slice(15) // drop its own straight lead-in, reuse left's straight tail as the gap
    const turnRates = [...left, ...right]
    const track = walkTrack(turnRates)
    const corners = detectCornersByCurvature(track, 0, track.valid.length, LENIENT)
    expect(corners).toHaveLength(2)
  })

  it('separates a same-direction combo (e.g. ARK 8-9-10) into three corners even though curvature never returns to zero between them', () => {
    // Three same-direction lobes: each a ramp 0->12->0, but the "valley" between
    // lobes is raised to 3 deg/step (never touches 0) rather than a real straight
    // — this is the case a naive "gap must reach ~0" merge rule would collapse
    // into one giant corner. Peak-with-prominence should still find 3 distinct
    // apexes because each lobe stands out above its neighbouring valleys.
    const lobe = (peak: number) => {
      const rampSteps = 12
      const out: number[] = []
      const half = rampSteps / 2
      for (let i = 0; i < rampSteps; i++) {
        const t = i < half ? i / half : (rampSteps - i) / half
        out.push(3 + (peak - 3) * t)
      }
      return out
    }
    const valley = new Array(8).fill(3) // never drops to 0 between lobes
    const turnRates = [
      ...new Array(15).fill(0), // straight entry
      ...lobe(12),
      ...valley,
      ...lobe(12),
      ...valley,
      ...lobe(12),
      ...new Array(15).fill(0), // straight exit
    ]
    const track = walkTrack(turnRates)
    const corners = detectCornersByCurvature(track, 0, track.valid.length, LENIENT)
    expect(corners).toHaveLength(3)
  })

  it('curvatureSignal reports monotonically increasing distance', () => {
    const track = walkTrack(singleHump(10, 10, 9))
    const sig = curvatureSignal(track)
    for (let i = 1; i < sig.distanceM.length; i++) {
      expect(sig.distanceM[i]).toBeGreaterThanOrEqual(sig.distanceM[i - 1])
    }
  })

  // Real-data motivated (see CURVATURE_DEFAULTS comment): GPS noise can
  // fragment one physical corner into 2-3 adjacent peaks, each individually
  // clearing the prominence bar, a few metres apart — well inside
  // minSpacingM=15. suppressNearby (exercised here via the real DEFAULTS, not
  // LENIENT) must collapse them to a single apex.
  it('merges GPS-noise-fragmented near-duplicate peaks (a few metres apart) into one apex under the real minSpacingM default', () => {
    // Two small sub-peaks riding on one broad corner ramp, ~6m apart
    // (stepM=2, 3-sample dip between them) — well under minSpacingM=15 —
    // each individually clearing CURVATURE_DEFAULTS' prominence/value floor.
    const turnRates = [
      ...new Array(20).fill(0),
      4, 8, 11, 8.5, 9, 12, 8, 4, // one broad ramp, double-humped by jitter
      ...new Array(20).fill(0),
    ]
    const track = walkTrack(turnRates, 2)
    const corners = detectCornersByCurvature(track, 0, track.valid.length, CURVATURE_DEFAULTS)
    expect(corners).toHaveLength(1)
  })

  it('keeps two corners distinct once their apexes are spaced beyond minSpacingM, even at the same jitter amplitude', () => {
    // Same two sub-peaks as above, but pulled apart by a real flat straight
    // long enough to clear minSpacingM=15 — should NOT merge. The straight
    // must also clearly out-span the detector's smoothing blur (smoothed
    // headings + boxSmooth halfWidth=2): at stepM=2 a ~20m gap leaves the
    // inter-peak valley too shallow for the second peak to clear
    // minProminence at all (a findPeaks effect, not NMS), so use ~50m —
    // still the same "beyond minSpacingM ⇒ distinct" contract.
    const bump = [4, 8, 11, 8, 4]
    const turnRates = [
      ...new Array(20).fill(0),
      ...bump,
      ...new Array(25).fill(0), // ~50m of straight (stepM=2) between apexes
      ...bump,
      ...new Array(20).fill(0),
    ]
    const track = walkTrack(turnRates, 2)
    const corners = detectCornersByCurvature(track, 0, track.valid.length, CURVATURE_DEFAULTS)
    expect(corners).toHaveLength(2)
  })
})

describe('pickReferenceLap', () => {
  it('does not let a broken/partial lap (fast but short) win over the fastest full-distance lap', () => {
    // A straight track, 1000 samples * 5m ≈ 5000m — distance is purely a
    // function of how many samples a "lap" spans, so it's easy to control.
    const track = walkTrack(new Array(999).fill(0))
    const laps: Lap[] = [
      { index: 0, startIdx: 0, endIdx: 150, lapTimeMs: 50000 }, // ~750m, 50s
      { index: 1, startIdx: 150, endIdx: 300, lapTimeMs: 48000 }, // ~750m, 48s — fastest FULL lap
      { index: 2, startIdx: 300, endIdx: 450, lapTimeMs: 51000 }, // ~750m, 51s
      { index: 3, startIdx: 450, endIdx: 480, lapTimeMs: 10000 }, // ~150m, 10s — broken sliver, numerically fastest by raw time
    ]
    const picked = pickReferenceLap(track, laps, [])
    expect(picked?.index).toBe(1)
  })

  it('falls back to the fastest overall when every lap looks equally short (no plausible majority to compare against)', () => {
    const track = walkTrack(new Array(199).fill(0))
    const laps: Lap[] = [
      { index: 0, startIdx: 0, endIdx: 50, lapTimeMs: 20000 },
      { index: 1, startIdx: 50, endIdx: 100, lapTimeMs: 15000 },
    ]
    const picked = pickReferenceLap(track, laps, [])
    expect(picked?.index).toBe(1)
  })

  it('respects exclusions and returns undefined when nothing qualifies', () => {
    const track = walkTrack(new Array(99).fill(0))
    const laps: Lap[] = [{ index: 0, startIdx: 0, endIdx: 50, lapTimeMs: 20000 }]
    expect(pickReferenceLap(track, laps, [0])).toBeUndefined()
    expect(pickReferenceLap(track, [], [])).toBeUndefined()
  })
})

describe('cornerGateLine', () => {
  it('builds a line just after the corner, perpendicular to local heading, halfWidthM to each side', () => {
    const turnRates = singleHump(20, 20, 9)
    const track = walkTrack(turnRates)
    const [corner] = detectCornersByCurvature(track, 0, track.valid.length, LENIENT)
    const halfWidthM = 15
    const line = cornerGateLine(track, corner, halfWidthM)

    // Each endpoint should be ~halfWidthM from the corner's apex.
    expect(haversineM(corner.lat, corner.lon, line.a.lat, line.a.lon)).toBeCloseTo(halfWidthM, 0)
    expect(haversineM(corner.lat, corner.lon, line.b.lat, line.b.lon)).toBeCloseTo(halfWidthM, 0)
    // The two endpoints should be ~2*halfWidthM apart (a straight line through the apex).
    expect(haversineM(line.a.lat, line.a.lon, line.b.lat, line.b.lon)).toBeCloseTo(halfWidthM * 2, 0)
  })

  it('places a detected gate between distinct GPS fixes so its own reference lap crosses it', () => {
    const track: GpsTrack = {
      lat: Float64Array.from([23, 23, 23, 23]),
      // The first two rows repeat one GPS fix, as ECU-rate logs commonly do.
      lon: Float64Array.from([120, 120, 120.0001, 120.0002]),
      valid: Uint8Array.from([1, 1, 1, 1]),
    }
    const corner = { index: 0, distanceM: 0, lat: 23, lon: 120, value: 1, prominence: 1 }
    const gate = cornerGateLine(track, corner)
    const crossed = walkLapGates(track, { startIdx: 0, endIdx: 3 }, [planarGate(gate)], () => {})
    expect(crossed).toBe(1)
  })
})
