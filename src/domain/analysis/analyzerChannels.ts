import type { LogSession } from '@/domain/model/LogSession'
import {
  cachedGearRatioTrace,
  gearRatioTraceError,
  type GearRatioTraceError,
} from '@/domain/analysis/gearRatioTrace'

/** Stable config identifier. Chart persistence stores this string, never the
 * derived Float64Array or a translated display label. */
export const MEASURED_TOTAL_RATIO_CHANNEL = '@derived/drivetrain/measured-total-ratio'

export interface AnalyzerChannelContext {
  wheelCircumferenceMm: number
}

export interface AnalyzerChannelResolution {
  data: ArrayLike<number> | null
  error: GearRatioTraceError | null
  derived: boolean
}

export function isDerivedAnalyzerChannel(id: string): boolean {
  return id === MEASURED_TOTAL_RATIO_CHANNEL
}

/** Resolve either an immutable session channel or a lazily computed virtual
 * analyzer channel. Unknown ids degrade to unavailable, matching a persisted
 * raw channel that is absent from the newly opened log. */
export function resolveAnalyzerChannel(
  session: LogSession,
  id: string,
  context: AnalyzerChannelContext,
): AnalyzerChannelResolution {
  if (id === MEASURED_TOTAL_RATIO_CHANNEL) {
    const result = cachedGearRatioTrace(session, context.wheelCircumferenceMm)
    return { data: result.data, error: result.error, derived: true }
  }
  return { data: session.get(id)?.data ?? null, error: null, derived: false }
}

/** Virtual channels which can actually be calculated for this session. */
export function availableDerivedAnalyzerChannels(
  session: LogSession,
  context: AnalyzerChannelContext,
): string[] {
  return gearRatioTraceError(session, context.wheelCircumferenceMm) == null
    ? [MEASURED_TOTAL_RATIO_CHANNEL]
    : []
}
