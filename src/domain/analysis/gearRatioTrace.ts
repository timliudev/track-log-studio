import type { LogSession } from '@/domain/model/LogSession'
import { computeRatioSeries } from '@/domain/analysis/drivetrain'
import { resolveRoleChannel, hashChannelRoleOverrides, type ChannelRoleOverrides } from '@/domain/analysis/channelRoles'

export type GearRatioTraceError = 'rpm' | 'speed' | 'circumference'

export interface GearRatioTraceResult {
  data: Float64Array | null
  error: GearRatioTraceError | null
}

const NO_OVERRIDES: ChannelRoleOverrides = {}

/** Cheap prerequisite check used by channel pickers. It intentionally does
 * not allocate the full derived array merely to decide whether an option can
 * be offered. `overrides` (B134) is threaded through to
 * `resolveRoleChannel` so a user-mapped or heuristically-resolved rpm/speed
 * channel counts as available here too — see `channelRoles.ts`'s module
 * header for the full resolution order. */
export function gearRatioTraceError(
  session: LogSession,
  wheelCircumferenceMm: number,
  overrides: ChannelRoleOverrides = NO_OVERRIDES,
): GearRatioTraceError | null {
  if (!resolveRoleChannel(session, 'rpm', overrides)) return 'rpm'
  if (!resolveRoleChannel(session, 'speed', overrides)) return 'speed'
  if (!Number.isFinite(wheelCircumferenceMm) || wheelCircumferenceMm <= 0) return 'circumference'
  return null
}

interface CachedTrace {
  circumferenceMm: number
  /** B134 — `hashChannelRoleOverrides(overrides)`; without this an override
   *  edit would silently keep serving the pre-override cached result. */
  overridesKey: string
  result: GearRatioTraceResult
}

/**
 * A session is immutable, while the user-controlled inputs to this derived
 * channel are wheel circumference and (B134) the channel-role override
 * table. Cache the latest result per session so several charts (and their
 * timeline/overlay computed branches) share one Float64Array instead of
 * allocating a full-log copy each time. WeakMap keeps unloaded sessions
 * collectable; no sample data is persisted.
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
  overrides: ChannelRoleOverrides = NO_OVERRIDES,
): GearRatioTraceResult {
  const prerequisiteError = gearRatioTraceError(session, wheelCircumferenceMm, overrides)
  if (prerequisiteError) return { data: null, error: prerequisiteError }
  const rpmName = resolveRoleChannel(session, 'rpm', overrides)
  if (!rpmName) return { data: null, error: 'rpm' }
  const speedName = resolveRoleChannel(session, 'speed', overrides)
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
  overrides: ChannelRoleOverrides = NO_OVERRIDES,
): GearRatioTraceResult {
  const overridesKey = hashChannelRoleOverrides(overrides)
  const cached = traceCache.get(session)
  if (cached && Object.is(cached.circumferenceMm, wheelCircumferenceMm) && cached.overridesKey === overridesKey) {
    return cached.result
  }
  const result = buildGearRatioTrace(session, wheelCircumferenceMm, overrides)
  traceCache.set(session, { circumferenceMm: wheelCircumferenceMm, overridesKey, result })
  return result
}
