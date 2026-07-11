import type { LogSession } from '@/domain/model/LogSession'
import { resolveSpeedChannel } from '@/domain/analysis/cornerSpeed'
import { computeRatioSeries, resolveRpmChannel } from '@/domain/analysis/drivetrain'

export type GearRatioTraceError = 'rpm' | 'speed' | 'circumference'

export interface GearRatioTraceResult {
  data: Float64Array | null
  error: GearRatioTraceError | null
}

/** Cheap prerequisite check used by channel pickers. It intentionally does
 * not allocate the full derived array merely to decide whether an option can
 * be offered. */
export function gearRatioTraceError(
  session: LogSession,
  wheelCircumferenceMm: number,
): GearRatioTraceError | null {
  if (!resolveRpmChannel(session)) return 'rpm'
  if (!resolveSpeedChannel(session)) return 'speed'
  if (!Number.isFinite(wheelCircumferenceMm) || wheelCircumferenceMm <= 0) return 'circumference'
  return null
}

interface CachedTrace {
  circumferenceMm: number
  result: GearRatioTraceResult
}

/**
 * A session is immutable, while the only user-controlled input to this
 * derived channel is wheel circumference. Cache the latest result per
 * session so several charts (and their timeline/overlay computed branches)
 * share one Float64Array instead of allocating a full-log copy each time.
 * WeakMap keeps unloaded sessions collectable; no sample data is persisted.
 */
const traceCache = new WeakMap<LogSession, CachedTrace>()

/**
 * Build the fixed, index-aligned source series used by the dashboard gear-
 * ratio chart. The physics deliberately stays in computeRatioSeries (the
 * same function GearPanel already uses); this adapter only resolves channel
 * aliases and pads unusual unequal-length inputs to the session row count so
 * uPlot/lap indices remain in the main chart system's sample space.
 */
export function buildGearRatioTrace(
  session: LogSession,
  wheelCircumferenceMm: number,
): GearRatioTraceResult {
  const prerequisiteError = gearRatioTraceError(session, wheelCircumferenceMm)
  if (prerequisiteError) return { data: null, error: prerequisiteError }
  const rpmName = resolveRpmChannel(session)
  if (!rpmName) return { data: null, error: 'rpm' }
  const speedName = resolveSpeedChannel(session)
  if (!speedName) return { data: null, error: 'speed' }

  const rpm = session.get(rpmName)?.data
  const speed = session.get(speedName)?.data
  if (!rpm) return { data: null, error: 'rpm' }
  if (!speed) return { data: null, error: 'speed' }

  const computed = computeRatioSeries(rpm, speed, { wheelCircumferenceMm })
  if (computed.length === session.rowCount) return { data: computed, error: null }

  const aligned = new Float64Array(session.rowCount).fill(NaN)
  aligned.set(computed.subarray(0, aligned.length))
  return { data: aligned, error: null }
}

export function cachedGearRatioTrace(
  session: LogSession,
  wheelCircumferenceMm: number,
): GearRatioTraceResult {
  const cached = traceCache.get(session)
  if (cached && Object.is(cached.circumferenceMm, wheelCircumferenceMm)) return cached.result
  const result = buildGearRatioTrace(session, wheelCircumferenceMm)
  traceCache.set(session, { circumferenceMm: wheelCircumferenceMm, result })
  return result
}
