/**
 * A11 — 變速齒比計算器 (gear-ratio / drivetrain tool), motorcycle context.
 *
 * Two independent layers, both pure math (no Vue/Pinia here — see
 * `GearPanel.vue` / `drivetrainStore` for the UI/state that calls into this):
 *
 * 1. **Calculator** (`computeMtGearTable` / `computeCvtSpeedRange`): turn a
 *    manually-entered drivetrain spec into speed/RPM outputs. Two drivetrain
 *    kinds:
 *    - MT (chain-drive, geared bike): primary reduction x per-gear ratio x
 *      final-drive (front/rear sprocket teeth) = total reduction per gear.
 *    - CVT (scooter): a continuously-variable ratio between a low and high
 *      bound x a fixed final/gear reduction — no discrete gears, so its
 *      output is a speed-at-RPM *range* rather than a per-gear table.
 *
 * 2. **Log inversion** (`computeRatioSeries` / `detectGearPlateaus` /
 *    `buildCvtRatioSweep`): given a loaded session's RPM + speed channels and
 *    the rider's wheel circumference, recover the ACTUAL total transmission
 *    ratio moment-to-moment (engine RPM / wheel RPM). For MT bikes the ratio
 *    trace sits on a handful of flat plateaus — one per gear — so clustering
 *    the filtered samples recovers the real-world ratios (which may differ
 *    slightly from a nominal spec due to tyre wear, sprocket swaps, etc). For
 *    CVT the ratio varies continuously with road speed/RPM, so instead of
 *    plateau-detection we just expose the (speed, ratio) sweep for plotting.
 *
 * All speed units are km/h, all RPM are engine RPM, all ratios are
 * dimensionless (engine turns per wheel turn) unless noted otherwise.
 */

import type { LogSession } from '@/domain/model/LogSession'

/**
 * Resolve the session's engine RPM channel name, or null if absent.
 * Canonical name is simply `RPM` (see `parseXrk.ts`'s `15: 'rpm'` mapping,
 * `vbo/semantic.ts`'s `RPM: {...}` and `Rc3NmeaExporter.ts`'s `arr('RPM')` —
 * every importer normalises to this one canonical name, unlike speed which
 * has a real GPS_Speed/Vehicle_Speed split). `LogSession.get`/`has` already
 * do alias resolution, so this is a thin, explicit wrapper — mirroring
 * `resolveSpeedChannel` in `cornerSpeed.ts` — rather than callers hardcoding
 * the string `'RPM'` themselves.
 */
export function resolveRpmChannel(session: LogSession): string | null {
  return session.has('RPM') ? 'RPM' : null
}

// ── Layer 1: pure calculator ────────────────────────────────────────────────

/** MT (chain-drive) drivetrain spec, manually entered. */
export interface MtDrivetrainSpec {
  /** Primary reduction ratio (crankshaft -> clutch/gearbox input). */
  primaryReduction: number
  /** Per-gear ratio, index 0 = 1st gear .. index N-1 = Nth gear. */
  gearRatios: number[]
  /** Front (countershaft) sprocket tooth count. */
  frontSprocketTeeth: number
  /** Rear (wheel) sprocket tooth count. */
  rearSprocketTeeth: number
  /** Rear wheel rolling circumference, millimetres. */
  wheelCircumferenceMm: number
  /** Redline / intended shift RPM. */
  redlineRpm: number
}

/** Per-gear calculator output. */
export interface MtGearResult {
  /** 1-based gear number. */
  gear: number
  /** Overall reduction: primary x gear x final drive (engine turns per wheel turn). */
  totalReduction: number
  /** Theoretical speed (km/h) when the engine is at `redlineRpm` in this gear. */
  speedAtRedlineKmh: number
}

/** Final-drive reduction: front (engine-side) teeth / rear (wheel-side) teeth. */
export function finalDriveRatio(frontTeeth: number, rearTeeth: number): number {
  if (!(frontTeeth > 0) || !(rearTeeth > 0)) return NaN
  return rearTeeth / frontTeeth
}

/**
 * Wheel RPM -> road speed (km/h) given a rolling circumference (mm).
 * speed(km/h) = wheelRpm * circumferenceMm(mm/rev) * 60(min/h) / 1e6(mm/km).
 */
export function wheelRpmToSpeedKmh(wheelRpm: number, circumferenceMm: number): number {
  if (!Number.isFinite(wheelRpm) || !(circumferenceMm > 0)) return NaN
  return (wheelRpm * circumferenceMm * 60) / 1_000_000
}

/** Inverse of {@link wheelRpmToSpeedKmh}: road speed (km/h) -> wheel RPM. */
export function speedKmhToWheelRpm(speedKmh: number, circumferenceMm: number): number {
  if (!Number.isFinite(speedKmh) || !(circumferenceMm > 0)) return NaN
  return (speedKmh * 1_000_000) / (circumferenceMm * 60)
}

/**
 * Full per-gear table for an MT drivetrain: total reduction and the
 * theoretical speed at the configured redline, for every gear in
 * `spec.gearRatios` (in order, 1-based `gear` field). Returns `[]` if the
 * spec is incomplete/invalid (non-positive sprocket teeth, circumference, or
 * no gears).
 */
export function computeMtGearTable(spec: MtDrivetrainSpec): MtGearResult[] {
  const final = finalDriveRatio(spec.frontSprocketTeeth, spec.rearSprocketTeeth)
  if (!Number.isFinite(final) || !(spec.primaryReduction > 0) || !(spec.wheelCircumferenceMm > 0)) {
    return []
  }
  const out: MtGearResult[] = []
  spec.gearRatios.forEach((g, i) => {
    if (!(g > 0)) return
    const totalReduction = spec.primaryReduction * g * final
    const wheelRpm = spec.redlineRpm / totalReduction
    const speedAtRedlineKmh = wheelRpmToSpeedKmh(wheelRpm, spec.wheelCircumferenceMm)
    out.push({ gear: i + 1, totalReduction, speedAtRedlineKmh })
  })
  return out
}

/**
 * Compact RPM -> speed lookup table for a single gear's total reduction, at
 * evenly-spaced RPM steps from 0 to `maxRpm` (inclusive), `steps` rows.
 * `steps` defaults to 10 (a readable table size for the UI).
 */
export function rpmSpeedTable(
  totalReduction: number,
  wheelCircumferenceMm: number,
  maxRpm: number,
  steps = 10,
): Array<{ rpm: number; speedKmh: number }> {
  if (!(totalReduction > 0) || !(wheelCircumferenceMm > 0) || !(maxRpm > 0) || steps < 1) return []
  const rows: Array<{ rpm: number; speedKmh: number }> = []
  for (let i = 1; i <= steps; i++) {
    const rpm = (maxRpm * i) / steps
    const wheelRpm = rpm / totalReduction
    rows.push({ rpm, speedKmh: wheelRpmToSpeedKmh(wheelRpm, wheelCircumferenceMm) })
  }
  return rows
}

/**
 * RPM drop when shifting up from `gear` to `gear + 1` at `redlineRpm`: how
 * far engine RPM falls the instant you shift, at constant road speed (speed
 * is continuous across the shift; only the reduction ratio changes, so
 * wheelRpm is shared and newEngineRpm = redlineRpm * (to.totalReduction /
 * from.totalReduction)). Returns NaN if `gear` is out of range (no next
 * gear in `results`) or either reduction is invalid.
 */
export function shiftRpmDrop(results: MtGearResult[], gear: number, redlineRpm: number): number {
  const from = results.find((r) => r.gear === gear)
  const to = results.find((r) => r.gear === gear + 1)
  if (!from || !to || !(from.totalReduction > 0) || !(to.totalReduction > 0) || !(redlineRpm > 0)) return NaN
  const newEngineRpm = redlineRpm * (to.totalReduction / from.totalReduction)
  return redlineRpm - newEngineRpm
}

/** CVT (scooter) drivetrain spec, manually entered. */
export interface CvtDrivetrainSpec {
  /** Lowest CVT ratio (numerically largest reduction — launch ratio). */
  ratioLow: number
  /** Highest CVT ratio (numerically smallest reduction — overdrive/top). */
  ratioHigh: number
  /** Fixed final/gear reduction downstream of the CVT belt/variator. */
  finalReduction: number
  /** Rear wheel rolling circumference, millimetres. */
  wheelCircumferenceMm: number
  /** Engine max/redline RPM. */
  maxRpm: number
}

export interface CvtSpeedRange {
  /** Speed (km/h) at `maxRpm` using the LOW (launch) ratio. */
  speedAtLowKmh: number
  /** Speed (km/h) at `maxRpm` using the HIGH (top/overdrive) ratio — the top speed. */
  speedAtHighKmh: number
}

/**
 * Speed range at the engine's max RPM across the CVT's ratio span: the low
 * ratio gives the (slower) speed reached at max RPM before the variator
 * shifts up; the high ratio gives the top speed at max RPM once fully
 * shifted. Returns speeds as NaN if the spec is invalid.
 */
export function computeCvtSpeedRange(spec: CvtDrivetrainSpec): CvtSpeedRange {
  const validBase =
    spec.ratioLow > 0 && spec.ratioHigh > 0 && spec.finalReduction > 0 && spec.wheelCircumferenceMm > 0 && spec.maxRpm > 0
  if (!validBase) return { speedAtLowKmh: NaN, speedAtHighKmh: NaN }
  const wheelRpmLow = spec.maxRpm / (spec.ratioLow * spec.finalReduction)
  const wheelRpmHigh = spec.maxRpm / (spec.ratioHigh * spec.finalReduction)
  return {
    speedAtLowKmh: wheelRpmToSpeedKmh(wheelRpmLow, spec.wheelCircumferenceMm),
    speedAtHighKmh: wheelRpmToSpeedKmh(wheelRpmHigh, spec.wheelCircumferenceMm),
  }
}

// ── Layer 2: log inversion ──────────────────────────────────────────────────

export interface RatioSeriesOptions {
  /** Rear wheel rolling circumference, millimetres. */
  wheelCircumferenceMm: number
  /**
   * Minimum speed (km/h) for a sample to be considered — below this, wheel
   * RPM is tiny/noisy (near-zero denominator) and clutch-slip at
   * standstill/parking-speed produces garbage ratios. Default 5 km/h.
   */
  minSpeedKmh?: number
}

/**
 * Compute the actual total transmission ratio at every sample:
 * ratio(t) = engineRpm(t) / wheelRpm(t), where wheelRpm is derived from
 * speedKmh via {@link speedKmhToWheelRpm}.
 *
 * Returns NaN at samples that are filtered out (non-finite RPM/speed, or
 * speed below `minSpeedKmh`) so the output stays index-aligned with the
 * input arrays — callers that need a dense array should filter NaN
 * themselves (see {@link detectGearPlateaus} / {@link buildCvtRatioSweep},
 * which do exactly that).
 */
export function computeRatioSeries(
  engineRpm: ArrayLike<number>,
  speedKmh: ArrayLike<number>,
  opts: RatioSeriesOptions,
): Float64Array {
  const n = Math.min(engineRpm.length, speedKmh.length)
  const minSpeed = opts.minSpeedKmh ?? 5
  const out = new Float64Array(n).fill(NaN)
  if (!(opts.wheelCircumferenceMm > 0)) return out
  for (let i = 0; i < n; i++) {
    const rpm = engineRpm[i]
    const speed = speedKmh[i]
    if (!Number.isFinite(rpm) || !Number.isFinite(speed) || speed < minSpeed || rpm <= 0) continue
    const wheelRpm = speedKmhToWheelRpm(speed, opts.wheelCircumferenceMm)
    if (!(wheelRpm > 0)) continue
    const ratio = rpm / wheelRpm
    if (Number.isFinite(ratio) && ratio > 0) out[i] = ratio
  }
  return out
}

/** A detected flat plateau in a ratio(t) trace — the recovered ratio for one gear. */
export interface GearPlateau {
  /** The clustered (mode) ratio value for this plateau. */
  ratio: number
  /** Number of samples that fell into this cluster. */
  sampleCount: number
}

export interface PlateauDetectionOptions {
  /**
   * Expected number of gears/plateaus to look for. When omitted, the
   * detector keeps merging clusters (see `toleranceFrac`) and returns
   * however many distinct clusters survive a minimum-sample-count floor.
   */
  gearCount?: number
  /**
   * Relative tolerance for clustering: two ratio samples are considered the
   * same plateau when they're within this fraction of each other
   * (default 0.03 = 3%, tolerant of GPS/RPM sensor noise and minor
   * within-gear ratio wobble from wheel-speed measurement jitter).
   */
  toleranceFrac?: number
  /**
   * Minimum fraction of all (filtered) samples a cluster must contain to be
   * reported as a real gear plateau rather than transient noise/shift
   * events (default 0.01 = 1%).
   */
  minSampleFrac?: number
}

/**
 * Recover per-gear ratio plateaus from a filtered ratio(t) trace (as
 * produced by {@link computeRatioSeries} — NaN entries are ignored).
 *
 * Approach: sort the finite ratio samples, then greedily group consecutive
 * sorted values into clusters using `toleranceFrac` relative distance (a
 * single left-to-right sweep — sorted data makes "close in value" equivalent
 * to "adjacent in the sorted array", so this is a simple/robust 1-D
 * clustering pass, no k-means/binning-boundary edge cases). Each cluster's
 * reported ratio is the MEDIAN of its members (robust to outliers within the
 * plateau, unlike a mean). Clusters below `minSampleFrac` of the total
 * sample count are dropped as noise/shift transients. If `gearCount` is
 * given, only the `gearCount` largest surviving clusters are kept (by
 * sample count), then re-sorted by ratio descending (1st gear = highest
 * ratio first, matching MT convention).
 *
 * Returns `[]` when there are fewer than a handful of finite samples.
 */
export function detectGearPlateaus(ratioSeries: ArrayLike<number>, opts: PlateauDetectionOptions = {}): GearPlateau[] {
  const toleranceFrac = opts.toleranceFrac ?? 0.03
  const minSampleFrac = opts.minSampleFrac ?? 0.01

  const finite: number[] = []
  for (let i = 0; i < ratioSeries.length; i++) {
    const v = ratioSeries[i]
    if (Number.isFinite(v) && v > 0) finite.push(v)
  }
  if (finite.length < 5) return []
  finite.sort((a, b) => a - b)

  // Greedy sweep: extend the current cluster while the next value is within
  // toleranceFrac of the cluster's running mean; otherwise close it and start
  // a new one.
  const clusters: number[][] = []
  let current: number[] = [finite[0]]
  let currentMean = finite[0]
  for (let i = 1; i < finite.length; i++) {
    const v = finite[i]
    const rel = Math.abs(v - currentMean) / currentMean
    if (rel <= toleranceFrac) {
      current.push(v)
      currentMean = current.reduce((a, b) => a + b, 0) / current.length
    } else {
      clusters.push(current)
      current = [v]
      currentMean = v
    }
  }
  clusters.push(current)

  const minCount = Math.max(1, Math.ceil(finite.length * minSampleFrac))
  let plateaus: GearPlateau[] = clusters
    .filter((c) => c.length >= minCount)
    .map((c) => ({ ratio: median(c), sampleCount: c.length }))

  if (opts.gearCount != null && opts.gearCount > 0 && plateaus.length > opts.gearCount) {
    plateaus = [...plateaus].sort((a, b) => b.sampleCount - a.sampleCount).slice(0, opts.gearCount)
  }

  // MT convention: 1st gear (highest ratio / most reduction) first.
  return plateaus.sort((a, b) => b.ratio - a.ratio)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** One point of a CVT's continuous ratio-vs-speed sweep, for plotting. */
export interface CvtRatioPoint {
  speedKmh: number
  ratio: number
}

/**
 * Build a (speed, ratio) sweep for a CVT from a filtered ratio(t) trace +
 * matching speed(t) — CVT ratio varies continuously with road speed, so
 * unlike MT there's no plateau to detect; this is a straightforward
 * point-per-sample export (NaN-filtered, sorted by speed) for a scatter/line
 * plot. Downsampling for chart performance is the caller's concern (reuse
 * `downsample.ts` if the trace is large), not this function's.
 */
export function buildCvtRatioSweep(
  ratioSeries: ArrayLike<number>,
  speedKmh: ArrayLike<number>,
): CvtRatioPoint[] {
  const n = Math.min(ratioSeries.length, speedKmh.length)
  const points: CvtRatioPoint[] = []
  for (let i = 0; i < n; i++) {
    const ratio = ratioSeries[i]
    const speed = speedKmh[i]
    if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(speed)) continue
    points.push({ speedKmh: speed, ratio })
  }
  points.sort((a, b) => a.speedKmh - b.speedKmh)
  return points
}
