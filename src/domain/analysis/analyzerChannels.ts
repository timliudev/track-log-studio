import type { LogSession } from '@/domain/model/LogSession'
import {
  cachedGearRatioTrace,
  gearRatioTraceError,
  type GearRatioTraceError,
} from '@/domain/analysis/gearRatioTrace'
import {
  CVT_DERIVED_CHANNELS,
  cachedCvtDerivedTraces,
  cvtChannelData,
  cvtChannelError,
  type CvtDerivedChannelId,
  type CvtTraceConfig,
  type CvtTraceError,
} from '@/domain/analysis/cvtTrace'

/** Stable config identifier. Chart persistence stores this string, never the
 * derived Float64Array or a translated display label. */
export const MEASURED_TOTAL_RATIO_CHANNEL = '@derived/drivetrain/measured-total-ratio'

export interface AnalyzerChannelContext {
  wheelCircumferenceMm: number
  fileId?: number | string
  cvtConfig?: CvtTraceConfig | null
}

export interface AnalyzerChannelResolution {
  data: ArrayLike<number> | null
  /** Source-provided physical unit, when available. */
  unit?: string
  error: GearRatioTraceError | CvtTraceError | null
  derived: boolean
}

export function isDerivedAnalyzerChannel(id: string): boolean {
  return id === MEASURED_TOTAL_RATIO_CHANNEL || CVT_DERIVED_CHANNELS.includes(id as CvtDerivedChannelId)
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
  if (CVT_DERIVED_CHANNELS.includes(id as CvtDerivedChannelId)) {
    if (!context.cvtConfig) return { data: null, error: 'fixed-reduction', derived: true }
    const result = cachedCvtDerivedTraces(session, context.fileId ?? 'unassigned', context.cvtConfig)
    const channelId = id as CvtDerivedChannelId
    return { data: cvtChannelData(result, channelId), error: cvtChannelError(result, channelId), derived: true }
  }
  const channel = session.get(id)
  return { data: channel?.data ?? null, unit: channel?.unit, error: null, derived: false }
}

/** Virtual channels which can actually be calculated for this session. */
export function availableDerivedAnalyzerChannels(
  session: LogSession,
  context: AnalyzerChannelContext,
): string[] {
  if (gearRatioTraceError(session, context.wheelCircumferenceMm) != null) return []
  const available = [MEASURED_TOTAL_RATIO_CHANNEL]
  if (!context.cvtConfig) return available
  const result = cachedCvtDerivedTraces(session, context.fileId ?? 'unassigned', context.cvtConfig)
  for (const id of CVT_DERIVED_CHANNELS) {
    if (cvtChannelData(result, id)) available.push(id)
  }
  return available
}
