/**
 * A11 — 變速齒比計算器 (gear-ratio / drivetrain tool), motorcycle context.
 *
 * Redesigned per user decisions #12/#13 (2026-07-03 feedback: the original
 * panel was confusing and its chart rendered empty — see `GearPanel.vue`'s
 * header comment for the root cause). The two drivetrain kinds now have
 * fundamentally different jobs:
 *
 * - **MT (檔車) = geometry calculator.** The user enters a full per-gear
 *   drivetrain spec (ratios or tooth counts, primary reduction, final drive,
 *   tire spec/circumference) and this module turns it into a per-gear
 *   speed(rpm) FUNCTION (`mtGearSpeedFn`) — not just a single redline point —
 *   so the UI can plot a theoretical speed-vs-RPM line per gear, overlaid on
 *   the measured RPM-vs-speed scatter recovered from the log (Layer 2 below).
 *   That overlay is the primary diagnostic: does the entered spec's line sit
 *   on top of the measured cluster for that gear?
 * - **CVT (速可達) = measured-curve presentation, NOT a geometry simulation.**
 *   A CVT's instantaneous ratio depends on belt/roller/spring tuning that
 *   isn't practically computable from a few numbers, so there is no
 *   calculator here — only the measured ratio(t)/ratio(rpm) curve (Layer 2)
 *   plus free-form NOTE fields for the tuning parameters the user records by
 *   hand (see `CvtNoteFields` in `drivetrainStore.ts`) so different setups can
 *   be compared.
 *
 * Two layers, both pure math (no Vue/Pinia here — see `GearPanel.vue` /
 * `drivetrainStore` for the UI/state that calls into this):
 *
 * 1. **Calculator** (`computeMtGearTable`, `mtGearSpeedFn`, tooth-count and
 *    tire-spec helpers below): turn a manually-entered MT drivetrain spec
 *    into per-gear total reduction + a speed(rpm) function for line-plotting.
 * 2. **Log inversion** (`computeRatioSeries` / `detectGearPlateaus` /
 *    `buildCvtRatioSweep`): given a loaded session's RPM + speed channels and
 *    the rider's wheel circumference, recover the ACTUAL total transmission
 *    ratio moment-to-moment (engine RPM / wheel RPM). For MT bikes the ratio
 *    trace sits on a handful of flat plateaus — one per gear — so clustering
 *    the filtered samples recovers the real-world ratios (which may differ
 *    slightly from a nominal spec due to tyre wear, sprocket swaps, etc). For
 *    CVT the ratio varies continuously with road speed/RPM, so instead of
 *    plateau-detection we just expose the (speed, ratio) sweep for plotting,
 *    plus launch/top ratio and clutch-engagement-RPM estimation.
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

/**
 * One gear's ratio input: EITHER a ratio directly, OR a driven/drive tooth
 * pair (gearbox output gear teeth / input gear teeth) — see {@link
 * toothCountRatio}. The panel lets the user pick per-gear which form they're
 * entering (spec sheets vary), so both are optional here; {@link
 * resolveGearRatio} picks whichever is present (ratio wins if both are set).
 */
export interface GearRatioInput {
  /** Direct gear ratio (input turns per output turn), if known. */
  ratio?: number
  /** Driven (output/countershaft) gear tooth count, if entering by teeth. */
  drivenTeeth?: number
  /** Drive (input/mainshaft) gear tooth count, if entering by teeth. */
  driveTeeth?: number
}

/** Tooth-count ratio: driven teeth / drive teeth (reduction when driven > drive). */
export function toothCountRatio(drivenTeeth: number, driveTeeth: number): number {
  if (!(drivenTeeth > 0) || !(driveTeeth > 0)) return NaN
  return drivenTeeth / driveTeeth
}

/**
 * Resolve a single gear's ratio from a {@link GearRatioInput}: prefer an
 * explicit `ratio`, else derive from `drivenTeeth`/`driveTeeth`. Returns NaN
 * if neither form yields a valid positive ratio.
 */
export function resolveGearRatio(input: GearRatioInput): number {
  if (input.ratio != null && input.ratio > 0) return input.ratio
  if (input.drivenTeeth != null && input.driveTeeth != null) {
    return toothCountRatio(input.drivenTeeth, input.driveTeeth)
  }
  return NaN
}

/**
 * Final drive input: EITHER a direct ratio, OR front/rear sprocket teeth
 * (e.g. 前13T/後41T). Mirrors {@link GearRatioInput}'s either/or shape.
 */
export interface FinalDriveInput {
  /** Direct final-drive ratio, if known. */
  ratio?: number
  /** Front (countershaft/engine-side) sprocket tooth count. */
  frontTeeth?: number
  /** Rear (wheel-side) sprocket tooth count. */
  rearTeeth?: number
}

/** Resolve a {@link FinalDriveInput} to a ratio: prefer explicit `ratio`, else
 *  front/rear teeth via {@link finalDriveRatio}. NaN if neither is valid. */
export function resolveFinalDrive(input: FinalDriveInput): number {
  if (input.ratio != null && input.ratio > 0) return input.ratio
  if (input.frontTeeth != null && input.rearTeeth != null) {
    return finalDriveRatio(input.frontTeeth, input.rearTeeth)
  }
  return NaN
}

/**
 * Parse a standard metric motorcycle tire size spec (`WIDTH/ASPECT-DIAMETER`,
 * e.g. `120/70-17`: 120mm section width, 70% aspect ratio, 17" rim diameter)
 * into a rolling circumference in millimetres.
 *
 * Formula: sidewall height = width * aspectRatio/100; overall diameter =
 * rimDiameter(in) * 25.4 + 2 * sidewallHeight; circumference = π * diameter.
 * (Known check: 120/70-17 → rim 431.8mm + 2*84mm sidewall = 599.8mm diameter
 * → ~1884.5mm circumference, in the right ballpark for a sport-bike front/rear.)
 *
 * Accepts a little formatting slack (extra spaces, `x` or `-` separator
 * before the diameter, e.g. `120/70x17` or `120/70 R17`). Returns NaN if the
 * string doesn't parse or any component is non-positive.
 */
export function tireSpecToCircumferenceMm(spec: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*[-xX]?\s*[Rr]?\s*(\d+(?:\.\d+)?)\s*$/.exec(spec)
  if (!m) return NaN
  const width = Number(m[1])
  const aspect = Number(m[2])
  const rimDiameterIn = Number(m[3])
  if (!(width > 0) || !(aspect > 0) || !(rimDiameterIn > 0)) return NaN
  const sidewallMm = (width * aspect) / 100
  const overallDiameterMm = rimDiameterIn * 25.4 + 2 * sidewallMm
  return Math.PI * overallDiameterMm
}

/** MT (chain-drive) drivetrain spec, manually entered. */
export interface MtDrivetrainSpec {
  /** Primary reduction ratio (crankshaft -> clutch/gearbox input). Optional —
   *  some bikes are direct-drive (no separate primary stage); treated as 1
   *  when omitted/non-positive. */
  primaryReduction?: number
  /** Per-gear ratio input, index 0 = 1st gear .. index N-1 = Nth gear. */
  gearRatios: GearRatioInput[]
  /** Final drive (front/rear sprocket teeth, or a direct ratio). */
  finalDrive: FinalDriveInput
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
 * `spec.gearRatios` (in order, 1-based `gear` field) that resolves to a valid
 * ratio. Returns `[]` if the spec is incomplete/invalid (no resolvable final
 * drive, non-positive circumference, or no valid gears).
 *
 * `primaryReduction` defaults to 1 (direct-drive / no separate primary
 * stage) when omitted or non-positive.
 */
export function computeMtGearTable(spec: MtDrivetrainSpec): MtGearResult[] {
  const final = resolveFinalDrive(spec.finalDrive)
  const primary = spec.primaryReduction != null && spec.primaryReduction > 0 ? spec.primaryReduction : 1
  if (!Number.isFinite(final) || !(spec.wheelCircumferenceMm > 0)) {
    return []
  }
  const out: MtGearResult[] = []
  spec.gearRatios.forEach((input, i) => {
    const g = resolveGearRatio(input)
    if (!(g > 0)) return
    const totalReduction = primary * g * final
    const wheelRpm = spec.redlineRpm / totalReduction
    const speedAtRedlineKmh = wheelRpmToSpeedKmh(wheelRpm, spec.wheelCircumferenceMm)
    out.push({ gear: i + 1, totalReduction, speedAtRedlineKmh })
  })
  return out
}

/**
 * Per-gear speed(rpm) function: given a gear's `totalReduction` (see {@link
 * MtGearResult}) and the wheel circumference, returns a function mapping
 * engine RPM -> theoretical road speed (km/h). Used to sample a theoretical
 * speed-vs-RPM LINE for chart overlay (one line per gear), rather than just
 * the single redline point `computeMtGearTable` reports.
 */
export function mtGearSpeedFn(totalReduction: number, wheelCircumferenceMm: number): (rpm: number) => number {
  return (rpm: number) => {
    if (!(totalReduction > 0) || !(wheelCircumferenceMm > 0)) return NaN
    return wheelRpmToSpeedKmh(rpm / totalReduction, wheelCircumferenceMm)
  }
}

/**
 * Sample a gear's theoretical speed-vs-RPM line at evenly-spaced RPM steps
 * from 0 to `maxRpm` (inclusive), `steps` points — for chart line overlay
 * (unlike {@link rpmSpeedTable}'s object-array shape, this returns parallel
 * arrays ready to slot into a uPlot `AlignedData`-style series).
 */
export function mtGearSpeedLine(
  totalReduction: number,
  wheelCircumferenceMm: number,
  maxRpm: number,
  steps = 40,
): { rpm: number[]; speedKmh: number[] } {
  const fn = mtGearSpeedFn(totalReduction, wheelCircumferenceMm)
  const rpm: number[] = []
  const speedKmh: number[] = []
  if (!(totalReduction > 0) || !(wheelCircumferenceMm > 0) || !(maxRpm > 0) || steps < 1) {
    return { rpm, speedKmh }
  }
  for (let i = 0; i <= steps; i++) {
    const r = (maxRpm * i) / steps
    rpm.push(r)
    speedKmh.push(fn(r))
  }
  return { rpm, speedKmh }
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

// CVT (速可達) is intentionally NOT a geometry calculator (decision #13): the
// belt/roller/spring tuning that determines its instantaneous ratio isn't
// practically computable from a handful of numbers, so unlike MT there is no
// `computeCvt...` spec->result function here. Instead, CVT gets a measured-
// curve PRESENTATION built entirely from Layer 2 (log inversion) below —
// `cvtRatioSummary` extracts launch/top ratio + clutch-engagement RPM from
// the same ratio(t)/speed(t) trace `buildCvtRatioSweep` already plots — plus
// free-form note fields for the tuning params themselves (see
// `CvtNoteFields` in `drivetrainStore.ts`).

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

/** One point of a CVT's ratio-vs-time trace, for plotting (index-aligned with
 *  the source session, `timeS` in seconds from session start — same axis the
 *  other analyzer time-series charts use). */
export interface CvtRatioTimePoint {
  timeS: number
  ratio: number
}

/**
 * Build a (time, ratio) trace for a CVT from a filtered ratio(t) trace +
 * matching per-sample time (seconds) — the "ratio vs time" view alongside
 * {@link buildCvtRatioSweep}'s "ratio vs speed" view. NaN-filtered, kept in
 * original (time) order.
 */
export function buildCvtRatioTimeSeries(
  ratioSeries: ArrayLike<number>,
  timeS: ArrayLike<number>,
): CvtRatioTimePoint[] {
  const n = Math.min(ratioSeries.length, timeS.length)
  const points: CvtRatioTimePoint[] = []
  for (let i = 0; i < n; i++) {
    const ratio = ratioSeries[i]
    const t = timeS[i]
    if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(t)) continue
    points.push({ timeS: t, ratio })
  }
  return points
}

/** Summary stats pulled from a CVT's measured ratio curve — the annotations
 *  the redesigned panel surfaces instead of a geometry simulation. */
export interface CvtRatioSummary {
  /** 起步比 — max ratio observed (numerically largest reduction, at launch). */
  launchRatio: number
  /** 最終比 — min ratio observed (numerically smallest reduction, at top speed/full shift-out). */
  topRatio: number
}

/**
 * Summarise a CVT's measured ratio curve: launch (max) and top (min) ratio
 * across all finite samples in `ratioSeries`. Returns NaN fields if there are
 * no finite samples.
 */
export function cvtRatioSummary(ratioSeries: ArrayLike<number>): CvtRatioSummary {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < ratioSeries.length; i++) {
    const v = ratioSeries[i]
    if (!Number.isFinite(v) || v <= 0) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!(max > -Infinity) || !(min < Infinity)) return { launchRatio: NaN, topRatio: NaN }
  return { launchRatio: max, topRatio: min }
}

export interface ClutchEngagementOptions {
  /** Speed (km/h) considered "standstill" — below this the bike is treated as
   *  stopped. Default 1 (GPS/wheel-speed noise floor). */
  standstillSpeedKmh?: number
  /** Speed (km/h) rise, sustained (see `sustainSamples`), that confirms the
   *  bike has actually started moving rather than a momentary blip. Default 3. */
  risingSpeedKmh?: number
  /** How many consecutive samples the speed must stay at/above
   *  `risingSpeedKmh` for the rise to count as "sustained" rather than sensor
   *  noise. Default 5. */
  sustainSamples?: number
}

/**
 * Estimate 離合器接合轉速 (clutch engagement RPM): the engine RPM at the
 * moment road speed first rises sustainedly from a standstill. Scans for a
 * sample where speed is at/below `standstillSpeedKmh`, then confirms that
 * speed reaches `risingSpeedKmh` and stays at/above it for `sustainSamples`
 * consecutive samples afterward (filtering out momentary GPS jitter) — the
 * ENGAGEMENT RPM reported is the engine RPM at that initial standstill
 * sample (the RPM the clutch was slipping in/holding just before the bike
 * started moving), not the RPM once already underway.
 *
 * This is a heuristic on launch behaviour, not a physical measurement — if a
 * session has no clean launch (e.g. never stops, or rider modulates the
 * throttle erratically at launch) the result may be unreliable; the caller
 * should let the user read the value off the ratio/RPM-vs-time curve
 * instead when this returns NaN (see `PlateauDetectionOptions`'s NaN
 * contract — same "read it off the chart" fallback design).
 *
 * Returns NaN if no qualifying standstill->sustained-rise event is found.
 */
export function estimateClutchEngagementRpm(
  engineRpm: ArrayLike<number>,
  speedKmh: ArrayLike<number>,
  opts: ClutchEngagementOptions = {},
): number {
  const standstill = opts.standstillSpeedKmh ?? 1
  const rising = opts.risingSpeedKmh ?? 3
  const sustain = opts.sustainSamples ?? 5
  const n = Math.min(engineRpm.length, speedKmh.length)

  for (let i = 0; i < n; i++) {
    const speed = speedKmh[i]
    if (!Number.isFinite(speed) || speed > standstill) continue
    const rpmAtStandstill = engineRpm[i]
    if (!Number.isFinite(rpmAtStandstill) || rpmAtStandstill <= 0) continue

    // Look ahead for a sustained rise above `rising`.
    let sustainedFrom = -1
    let run = 0
    for (let j = i + 1; j < n; j++) {
      const s = speedKmh[j]
      if (Number.isFinite(s) && s >= rising) {
        run++
        if (run >= sustain) {
          sustainedFrom = j - sustain + 1
          break
        }
      } else if (Number.isFinite(s) && s <= standstill) {
        // Still stopped — keep waiting at this same standstill sample's RPM.
        run = 0
      } else {
        run = 0
      }
    }
    if (sustainedFrom >= 0) return rpmAtStandstill
  }
  return NaN
}
