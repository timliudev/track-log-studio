import { computed, watch } from 'vue'
import { useFileStore } from '@/stores/fileStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useLapStore } from '@/stores/lapStore'

/**
 * B137 — keeps the analyzer's primary / comparison selection consistent with
 * the set of ready files. It used to live in AnalyzerView, but that view is
 * lazy-loaded behind a `<Transition mode="out-in">`, so on a tab switch the
 * shared FileBar was already in analyzer mode (showing no primary) for a few
 * hundred ms before the watcher ran. Installed once from App.vue, it is
 * always in effect regardless of which tab is mounted.
 *
 * Semantics (unchanged from the AnalyzerView original):
 *  - comparisons = selected sessions that are still ready and not the primary
 *  - primary vanished/unset → promote first comparison, else first ready file;
 *    B55: fold the promoted recording's per-lap state into the primary facet
 *    via lapStore.swapPrimarySession(null, next) BEFORE flipping activeFileId
 *  - otherwise just prune vanished comparisons
 */
export function useAnalyzerSelectionSync(): void {
  const fileStore = useFileStore()
  const analyzer = useAnalyzerStore()
  const lapStore = useLapStore()

  const readyFiles = computed(() => fileStore.files.filter((f) => f.status === 'ready'))

  watch(
    readyFiles,
    (files) => {
      const readyIds = new Set(files.map((file) => file.id))
      const comparisons = analyzer.selectedSessions.filter(
        (id) => readyIds.has(id) && id !== analyzer.activeFileId,
      )
      const activeExists = analyzer.activeFileId != null && readyIds.has(analyzer.activeFileId)
      if (!activeExists) {
        const nextPrimary = comparisons[0] ?? files[0]?.id ?? null
        // B55 — the outgoing primary's file is GONE (removed/failed), so
        // there's nothing to fold it back into; but if a comparison recording
        // is being promoted in its place, that recording's own per-lap state
        // should become the new primary-facet state, same as an explicit
        // FileBar makePrimary swap (see lapStore.swapPrimarySession).
        if (nextPrimary != null) lapStore.swapPrimarySession(null, nextPrimary)
        analyzer.activeFileId = nextPrimary
        analyzer.selectedSessions = comparisons.filter((id) => id !== nextPrimary)
      } else if (comparisons.length !== analyzer.selectedSessions.length) {
        analyzer.selectedSessions = comparisons
      }
    },
    { immediate: true },
  )
}
