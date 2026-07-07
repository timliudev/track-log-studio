import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEY,
  defaultCharts,
  nextChartId,
  parseCharts,
  loadCharts,
  saveCharts,
  type ChartConfig,
} from '@/domain/layout/chartConfigs'

/** Node test environment — in-memory localStorage stub, same approach as
 *  dashboardLayout.test.ts / panelState.test.ts. */
function installMemoryLocalStorage(): void {
  let store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store = new Map<string, string>()
    },
  })
}

beforeEach(() => {
  installMemoryLocalStorage()
  localStorage.clear()
})

describe('chartConfigs — parseCharts (T5)', () => {
  it('round-trips a mixed timeseries + scatter list', () => {
    const charts: ChartConfig[] = [
      { kind: 'timeseries', id: 1, channels: ['RPM', 'TPS_Percent'], mode: 'overlay' },
      { kind: 'scatter', id: 2, xChannel: 'TC_Xforce', yChannel: null, equalAspect: false },
    ]
    expect(parseCharts(JSON.stringify(charts))).toEqual(charts)
  })

  it('backfills equalAspect: true on pre-feature scatter payloads (default is ON)', () => {
    // A payload persisted before the XY-aspect feature has no equalAspect
    // field at all — restored charts must default to the new 1:1 behaviour.
    const raw = JSON.stringify([{ kind: 'scatter', id: 2, xChannel: 'RPM', yChannel: 'Vehicle_Speed' }])
    expect(parseCharts(raw)).toEqual([
      { kind: 'scatter', id: 2, xChannel: 'RPM', yChannel: 'Vehicle_Speed', equalAspect: true },
    ])
  })

  it('coerces a non-boolean equalAspect back to the default true', () => {
    const raw = JSON.stringify([{ kind: 'scatter', id: 2, xChannel: null, yChannel: null, equalAspect: 'yes' }])
    expect(parseCharts(raw)).toEqual([
      { kind: 'scatter', id: 2, xChannel: null, yChannel: null, equalAspect: true },
    ])
  })

  it('returns null for missing/corrupt/non-array JSON', () => {
    expect(parseCharts(null)).toBeNull()
    expect(parseCharts('')).toBeNull()
    expect(parseCharts('{not json')).toBeNull()
    expect(parseCharts('{"kind":"timeseries"}')).toBeNull()
  })

  it('keeps a valid EMPTY array — "user removed every chart" must survive reload', () => {
    expect(parseCharts('[]')).toEqual([])
  })

  it('skips malformed entries (bad kind / missing id) and keeps the valid rest', () => {
    const raw = JSON.stringify([
      { kind: 'pie', id: 1 },
      { kind: 'timeseries' }, // no id
      { kind: 'timeseries', id: 'x', channels: [] }, // non-numeric id
      { kind: 'scatter', id: 3, xChannel: 42, yChannel: 'RPM' }, // bad xChannel -> null
      { kind: 'timeseries', id: 4, channels: ['RPM', 5], mode: 'weird' }, // bad channels/mode
    ])
    expect(parseCharts(raw)).toEqual([
      { kind: 'scatter', id: 3, xChannel: null, yChannel: 'RPM', equalAspect: true },
      { kind: 'timeseries', id: 4, channels: [], mode: 'timeline' },
    ])
  })

  it('de-duplicates ids, keeping the first occurrence', () => {
    const raw = JSON.stringify([
      { kind: 'timeseries', id: 1, channels: ['RPM'], mode: 'timeline' },
      { kind: 'scatter', id: 1, xChannel: null, yChannel: null },
    ])
    expect(parseCharts(raw)).toEqual([
      { kind: 'timeseries', id: 1, channels: ['RPM'], mode: 'timeline' },
    ])
  })
})

describe('chartConfigs — load/save (T5)', () => {
  it('loadCharts falls back to the single default chart when nothing is stored', () => {
    expect(loadCharts()).toEqual(defaultCharts())
  })

  it('loadCharts restores what saveCharts wrote (dynamically added charts included)', () => {
    const charts: ChartConfig[] = [
      { kind: 'timeseries', id: 1, channels: [], mode: 'timeline' },
      { kind: 'timeseries', id: 2, channels: ['RPM'], mode: 'overlay' },
      { kind: 'scatter', id: 3, xChannel: 'TC_Xforce', yChannel: 'TC_Yforce', equalAspect: false },
    ]
    saveCharts(charts)
    expect(loadCharts()).toEqual(charts)
  })

  it('loadCharts falls back to default on corrupt storage', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    expect(loadCharts()).toEqual(defaultCharts())
  })

  it('saveCharts does not throw when localStorage.setItem fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(() => saveCharts(defaultCharts())).not.toThrow()
  })

  it('loadCharts does not throw when localStorage access itself throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
    })
    expect(loadCharts()).toEqual(defaultCharts())
  })
})

describe('chartConfigs — nextChartId (T5)', () => {
  it('is one past the highest id (ids never reused across restores)', () => {
    expect(
      nextChartId([
        { kind: 'timeseries', id: 1, channels: [], mode: 'timeline' },
        { kind: 'scatter', id: 7, xChannel: null, yChannel: null, equalAspect: true },
      ]),
    ).toBe(8)
  })

  it('starts at 1 for an empty list', () => {
    expect(nextChartId([])).toBe(1)
  })
})
