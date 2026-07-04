import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useFileStore, type ImportedFile } from '@/stores/fileStore'
import { LogSession } from '@/domain/model/LogSession'
import { crossCorrelateOffset, type AlignmentResult } from '@/domain/analysis/sessionAlign'
import { mergeSessions } from '@/domain/analysis/sessionMerge'
import { resolveSpeedChannel } from '@/domain/analysis/cornerSpeed'

/** Lag search window and scan step passed to {@link crossCorrelateOffset} —
 *  generous defaults per docs/PHASE5-MERGE-STATUS.md's suggestion #6: two
 *  independently-started recorders could be many seconds (even minutes) apart,
 *  and a coarser 100ms scan step is plenty of precision for a manual nudge to
 *  refine afterwards. */
const DEFAULT_MAX_LAG_MS = 60_000
const DEFAULT_STEP_MS = 100

/** Manual offset nudge step (ms) for the fine-tune +/- buttons. */
export const NUDGE_STEP_MS = 100

/** One candidate session offered to the merge panel's pickers. */
export interface MergeCandidate {
  id: number
  name: string
  /** True when this file's own speed channel resolves (needed to align/merge). */
  hasSpeedChannel: boolean
}

/**
 * Phase 5 UI wiring: pick a "base" session (e.g. a .loga with broken/missing
 * GPS) and a "GPS" session (e.g. a RaceChrono .nmea) from the ready files in
 * fileStore, auto-detect the clock offset between them via cross-correlating
 * their speed channels, let the user nudge that offset by hand, and — once
 * happy — merge the GPS channels into the base session's own time axis and
 * register the result back into fileStore as a new ready session (so it's
 * immediately usable in the analyzer and exportable via the converter).
 *
 * Kept as a composable (not inlined in a component) per the project's
 * AnalyzerView-composables architecture: this is pure state + orchestration
 * over the domain functions (sessionAlign.ts/sessionMerge.ts), no rendering.
 */
export function useSessionMerge(): {
  candidates: ComputedRef<MergeCandidate[]>
  baseId: Ref<number | null>
  gpsId: Ref<number | null>
  canAlign: ComputedRef<boolean>
  alignment: Ref<AlignmentResult | null>
  offsetMs: Ref<number | null>
  autoAlign: () => void
  nudge: (deltaMs: number) => void
  canMerge: ComputedRef<boolean>
  merge: () => number | null
  lastError: Ref<string | null>
} {
  const fileStore = useFileStore()

  const baseId = ref<number | null>(null)
  const gpsId = ref<number | null>(null)
  const offsetMs = ref<number | null>(null)
  const lastError = ref<string | null>(null)

  // Every ready file is offered on both sides — Phase 5's use case (loga with
  // broken GPS + a clean .nmea) is the common one, but nothing here requires
  // the GPS side to literally be format 'nmea', so no format filtering: the
  // user picks any two ready sessions.
  const candidates = computed<MergeCandidate[]>(() =>
    fileStore.readyFiles.map((f: ImportedFile) => {
      const session = fileStore.getSession(f.id)
      return {
        id: f.id,
        name: f.name,
        hasSpeedChannel: session != null && resolveSpeedChannel(session) != null,
      }
    }),
  )

  const canAlign = computed(() => {
    if (baseId.value == null || gpsId.value == null || baseId.value === gpsId.value) return false
    const base = fileStore.getSession(baseId.value)
    const gps = fileStore.getSession(gpsId.value)
    return base != null && gps != null && resolveSpeedChannel(base) != null && resolveSpeedChannel(gps) != null
  })

  const alignment = ref<AlignmentResult | null>(null)

  /** Run cross-correlation now (not reactive/computed on purpose — this is an
   *  explicit, potentially expensive action the user triggers, not something
   *  that should silently re-run on every dependency tick). */
  function autoAlign(): void {
    lastError.value = null
    alignment.value = null
    if (!canAlign.value || baseId.value == null || gpsId.value == null) return

    const base = fileStore.getSession(baseId.value)
    const gps = fileStore.getSession(gpsId.value)
    const baseSpeedName = base ? resolveSpeedChannel(base) : null
    const gpsSpeedName = gps ? resolveSpeedChannel(gps) : null
    const baseTime = base?.timeChannel
    const gpsTime = gps?.timeChannel
    if (!base || !gps || !baseSpeedName || !gpsSpeedName || !baseTime || !gpsTime) {
      lastError.value = 'missingSpeedOrTime'
      return
    }
    const baseSpeed = base.get(baseSpeedName)
    const gpsSpeed = gps.get(gpsSpeedName)
    if (!baseSpeed || !gpsSpeed) {
      lastError.value = 'missingSpeedOrTime'
      return
    }

    const result = crossCorrelateOffset(baseSpeed.data, baseTime.data, gpsSpeed.data, gpsTime.data, {
      maxLagMs: DEFAULT_MAX_LAG_MS,
      stepMs: DEFAULT_STEP_MS,
    })
    if (!result) {
      lastError.value = 'alignFailed'
      return
    }
    alignment.value = result
    offsetMs.value = result.offsetMs
  }

  /** Fine-tune the auto-detected (or manually started) offset by `deltaMs`,
   *  without re-running correlation — see PHASE5-MERGE-STATUS.md #3. */
  function nudge(deltaMs: number): void {
    offsetMs.value = (offsetMs.value ?? 0) + deltaMs
  }

  const canMerge = computed(() => canAlign.value && offsetMs.value != null)

  /** Build the merged session and register it into fileStore. Returns the new
   *  file id, or null if inputs are missing/merge failed (see sessionMerge.ts). */
  function merge(): number | null {
    lastError.value = null
    if (baseId.value == null || gpsId.value == null || offsetMs.value == null) return null
    const base = fileStore.getSession(baseId.value)
    const gps = fileStore.getSession(gpsId.value)
    if (!base || !gps) return null

    const channels = mergeSessions(base, gps, { offsetMs: offsetMs.value })
    if (!channels) {
      lastError.value = 'mergeFailed'
      return null
    }

    const merged = new LogSession(channels, base.meta)
    const baseFile = fileStore.files.find((f) => f.id === baseId.value)
    const baseName = baseFile ? baseFile.name.replace(/\.[^./]+$/, '') : 'session'
    const name = `${baseName}_merged.loga`
    return fileStore.addMergedSession(name, merged)
  }

  return {
    candidates,
    baseId,
    gpsId,
    canAlign,
    alignment,
    offsetMs,
    autoAlign,
    nudge,
    canMerge,
    merge,
    lastError,
  }
}
