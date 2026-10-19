import { beforeEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useAnalyzerSelectionSync } from '@/composables/useAnalyzerSelectionSync'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useFileStore } from '@/stores/fileStore'
import { useLapStore } from '@/stores/lapStore'
import { LogSession } from '@/domain/model/LogSession'

function session(): LogSession {
  return new LogSession(
    [{ name: 'Time', rawName: 'Time', description: undefined, data: new Float32Array([0, 1, 2]) }],
    { formatId: 'test', createdDate: null, headerInfo: {} },
  )
}

// B137 — the selection sync runs from App.vue, with NO AnalyzerView mounted.
describe('useAnalyzerSelectionSync (B137)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function install(): void {
    effectScope().run(() => useAnalyzerSelectionSync())
  }

  it('selects the first ready file as primary without AnalyzerView mounted', async () => {
    const files = useFileStore()
    const analyzer = useAnalyzerStore()
    const a = files.addMergedSession('a.loga', session())
    files.addMergedSession('b.loga', session())
    install()
    // immediate: effective synchronously at setup time
    expect(analyzer.activeFileId).toBe(a)
    await nextTick()
    expect(analyzer.activeFileId).toBe(a)
  })

  it('picks a primary when a file becomes ready after install', async () => {
    const files = useFileStore()
    const analyzer = useAnalyzerStore()
    install()
    expect(analyzer.activeFileId).toBeNull()
    const a = files.addMergedSession('a.loga', session())
    await nextTick()
    expect(analyzer.activeFileId).toBe(a)
  })

  it('prunes comparison selections whose files vanished', async () => {
    const files = useFileStore()
    const analyzer = useAnalyzerStore()
    const a = files.addMergedSession('a.loga', session())
    const b = files.addMergedSession('b.loga', session())
    const c = files.addMergedSession('c.loga', session())
    install()
    analyzer.selectedSessions = [b, c]
    files.removeFile(c)
    await nextTick()
    expect(analyzer.activeFileId).toBe(a)
    expect(analyzer.selectedSessions).toEqual([b])
  })

  it('B55: promotes a comparison to primary and migrates its per-lap state', async () => {
    const files = useFileStore()
    const analyzer = useAnalyzerStore()
    const lapStore = useLapStore()
    const a = files.addMergedSession('a.loga', session())
    const b = files.addMergedSession('b.loga', session())
    install()
    analyzer.selectedSessions = [b]
    lapStore.toggleLap(0) // outgoing primary's own state: discarded
    lapStore.toggleSessionLap(b, 3) // comparison's per-session state: promoted
    files.removeFile(a)
    await nextTick()
    expect(analyzer.activeFileId).toBe(b)
    expect(analyzer.selectedSessions).toEqual([])
    expect(lapStore.selected).toEqual([3])
    expect(lapStore.selectedAcrossSessions).toEqual([])
  })

  it('clears the primary when the last file is removed', async () => {
    const files = useFileStore()
    const analyzer = useAnalyzerStore()
    const a = files.addMergedSession('a.loga', session())
    install()
    files.removeFile(a)
    await nextTick()
    expect(analyzer.activeFileId).toBeNull()
  })
})
