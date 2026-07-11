import { computed, type ComputedRef } from 'vue'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useFileStore } from '@/stores/fileStore'
import { useLapStore } from '@/stores/lapStore'
import { useSuspensionStore } from '@/stores/suspensionStore'
import { applyDerivedChannels } from '@/domain/units/suspension'
import { categoricalColor } from '@/domain/analysis/colorPalette'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import { extractGpsTrack, hasGps } from '@/domain/analysis/gpsTrack'
import { detectLapsByChannel, detectLapsByLine } from '@/domain/analysis/laps'
import { timeSeconds } from '@/domain/analysis/timeAxis'
import type { LogSession } from '@/domain/model/LogSession'

export interface SessionComparisonCandidate {
  id: number
  name: string
  color: string
  active: boolean
}

/** A selected comparison session, ready for timeline rendering. `xValues`
 * already includes automatic start-line alignment and the user's manual
 * per-session offset. */
export interface ComparisonSession {
  id: number
  name: string
  color: string
  session: LogSession
  xValues: Float64Array
}

function axisValues(session: LogSession, axis: 'time' | 'distance'): Float64Array | null {
  if (axis === 'time') return timeSeconds(session)
  const track = extractGpsTrack(session)
  return hasGps(track)
    ? cumulativeDistanceM(track.lat, track.lon, track.valid)
    : null
}

/** First complete lap's start on the requested axis. A shared user line is
 * preferred; ECU laps are a format-agnostic fallback. No detectable lap means
 * no implicit alignment (origin 0), matching the design's safe fallback. */
function firstLapOrigin(
  session: LogSession,
  axis: 'time' | 'distance',
  line: ReturnType<typeof useLapStore>['line'],
): number | null {
  const x = axisValues(session, axis)
  if (!x) return null
  const seconds = timeSeconds(session)
  const timeMs = Float64Array.from(seconds, (v) => v * 1000)
  const track = extractGpsTrack(session)
  const laps = line && hasGps(track)
    ? detectLapsByLine(track, timeMs, line)
    : session.has('IR_LapNumber')
      ? detectLapsByChannel(session, timeMs)
      : []
  const idx = laps[0]?.startIdx
  return idx != null && Number.isFinite(x[idx]) ? x[idx] : null
}

function shifted(values: Float64Array, delta: number): Float64Array {
  if (delta === 0) return values
  return Float64Array.from(values, (v) => v + delta)
}

/** Global comparison selection shared by timeline charts and the track map.
 * The active file remains the primary session and is always excluded from the
 * comparison output, even if its id is still selected after a primary switch. */
export function useSessionComparison(): {
  candidates: ComputedRef<SessionComparisonCandidate[]>
  comparisonSessions: ComputedRef<ComparisonSession[]>
  toggle: (id: number) => void
  clear: () => void
} {
  const analyzer = useAnalyzerStore()
  const fileStore = useFileStore()
  const lapStore = useLapStore()
  const suspension = useSuspensionStore()

  const candidates = computed<SessionComparisonCandidate[]>(() => {
    const selected = new Set(analyzer.selectedSessions)
    return fileStore.readyFiles
      .filter((file) => file.id !== analyzer.activeFileId)
      .map((file) => ({
        id: file.id,
        name: file.name,
        color: categoricalColor(file.id),
        active: selected.has(file.id),
      }))
  })

  const comparisonSessions = computed<ComparisonSession[]>(() => {
    const activeId = analyzer.activeFileId
    const primaryRaw = activeId == null ? undefined : fileStore.getSession(activeId)
    const primary = primaryRaw ? applyDerivedChannels(primaryRaw, suspension.config) : null
    const primaryOrigin = primary
      ? firstLapOrigin(primary, analyzer.xAxis, lapStore.line)
      : null
    const out: ComparisonSession[] = []

    for (const id of analyzer.selectedSessions) {
      if (id === activeId) continue
      const file = fileStore.files.find((entry) => entry.id === id && entry.status === 'ready')
      const raw = fileStore.getSession(id)
      if (!file || !raw) continue
      const session = applyDerivedChannels(raw, suspension.config)
      const rawX = axisValues(session, analyzer.xAxis)
      if (!rawX) continue

      // Scheme A from the design: align each comparison's first complete lap
      // crossing to the primary's crossing. If either side has no detectable
      // lap, use zero implicit shift and retain the manual offset only.
      const ownOrigin = firstLapOrigin(session, analyzer.xAxis, lapStore.line)
      const autoDelta = primaryOrigin != null && ownOrigin != null
        ? primaryOrigin - ownOrigin
        : 0
      const offset = analyzer.sessionOffsetOf(id)
      const manualDelta = analyzer.xAxis === 'distance' ? offset.distM : offset.timeSec
      out.push({
        id,
        name: file.name,
        color: categoricalColor(id),
        session,
        xValues: shifted(rawX, autoDelta + manualDelta),
      })
    }
    return out
  })

  return {
    candidates,
    comparisonSessions,
    toggle: analyzer.toggleSessionComparison,
    clear: analyzer.clearSessionComparisons,
  }
}
