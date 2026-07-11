import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionComparison } from '@/composables/useSessionComparison'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useFileStore } from '@/stores/fileStore'
import { categoricalColor } from '@/domain/analysis/colorPalette'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

function channel(name: string, values: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(values) }
}

function session(offsetMs = 0): LogSession {
  return new LogSession([
    channel('Time', [offsetMs, offsetMs + 1000, offsetMs + 2000]),
    channel('RPM', [1000, 2000, 3000]),
  ], {
    formatId: 'test',
    createdDate: null,
    headerInfo: {},
  })
}

beforeEach(() => setActivePinia(createPinia()))

describe('useSessionComparison', () => {
  it('lists all other ready sessions with stable file-id colors', () => {
    const files = useFileStore()
    const analyzer = useAnalyzerStore()
    const primaryId = files.addMergedSession('primary.loga', session())
    const otherId = files.addMergedSession('other.loga', session())
    analyzer.activeFileId = primaryId

    const { candidates } = useSessionComparison()
    expect(candidates.value).toEqual([{
      id: otherId,
      name: 'other.loga',
      color: categoricalColor(otherId),
      active: false,
    }])
  })

  it('returns selected sessions with the active-axis manual offset applied', () => {
    const files = useFileStore()
    const analyzer = useAnalyzerStore()
    const primaryId = files.addMergedSession('primary.loga', session())
    const otherId = files.addMergedSession('other.loga', session(5000))
    analyzer.activeFileId = primaryId
    analyzer.toggleSessionComparison(otherId)
    analyzer.nudgeSessionOffset(otherId, 'timeSec', 1.25)

    const { comparisonSessions } = useSessionComparison()
    expect(Array.from(comparisonSessions.value[0].xValues)).toEqual([1.25, 2.25, 3.25])
    expect(comparisonSessions.value[0].session.get('RPM')?.data[2]).toBe(3000)
  })

  it('silently drops stale ids and excludes a selected id when it becomes primary', () => {
    const files = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = files.addMergedSession('a.loga', session())
    const bId = files.addMergedSession('b.loga', session())
    analyzer.activeFileId = aId
    analyzer.toggleSessionComparison(bId)
    const { comparisonSessions } = useSessionComparison()
    expect(comparisonSessions.value.map((entry) => entry.id)).toEqual([bId])

    analyzer.activeFileId = bId
    expect(comparisonSessions.value).toEqual([])
    files.removeFile(bId)
    expect(comparisonSessions.value).toEqual([])
  })
})
