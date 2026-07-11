import type { LogSession } from '@/domain/model/LogSession'
import { resolveSpeedChannel } from '@/domain/analysis/cornerSpeed'
import { computeRatioSeries, resolveRpmChannel } from '@/domain/analysis/drivetrain'

export type GearRatioTraceError = 'rpm' | 'speed' | 'circumference'

export interface GearRatioTraceResult {
  data: Float64Array | null
  error: GearRatioTraceError | null
}

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
  const rpmName = resolveRpmChannel(session)
  if (!rpmName) return { data: null, error: 'rpm' }
  const speedName = resolveSpeedChannel(session)
  if (!speedName) return { data: null, error: 'speed' }
  if (!Number.isFinite(wheelCircumferenceMm) || wheelCircumferenceMm <= 0) {
    return { data: null, error: 'circumference' }
  }

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
