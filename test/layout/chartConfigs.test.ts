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
  it('round-trips a mixed timeseries + scatter + gear-ratio list', () => {
    const charts: ChartConfig[] = [
      { kind: 'timeseries', id: 1, channels: ['RPM', 'TPS_Percent'], mode: 'overlay' },
      { kind: 'scatter', id: 2, xChannel: 'TC_Xforce', yChannel: null, equalAspect: false, colorChannel: null },
      { kind: 'gearRatio', id: 3, mode: 'overlay' },
    ]
    expect(parseCharts(JSON.stringify(charts))).toEqual(charts)
  })

  it('round-trips a picked colour-axis channel', () => {
    const charts: ChartConfig[] = [
      {
        kind: 'scatter',
        id: 2,
        xChannel: 'TC_Xforce',
        yChannel: 'TC_Yforce',
        equalAspect: true,
        colorChannel: 'Vehicle_Speed',
      },
    ]
    expect(parseCharts(JSON.stringify(charts))).toEqual(charts)
  })

  it('backfills equalAspect from the channel pair on pre-feature payloads — false for a non-force pair (#5 fix)', () => {
    // A payload persisted before the XY-aspect feature has no equalAspect
    // field at all — restored charts backfill from the channel pair itself
    // (true only for a force/acceleration pair), not a blanket true.
    const raw = JSON.stringify([{ kind: 'scatter', id: 2, xChannel: 'RPM', yChannel: 'Vehicle_Speed' }])
    expect(parseCharts(raw)).toEqual([
      { kind: 'scatter', id: 2, xChannel: 'RPM', yChannel: 'Vehicle_Speed', equalAspect: false, colorChannel: null },
    ])
  })

  it('backfills equalAspect: true on pre-feature payloads whose channel pair IS a force pair', () => {
    const raw = JSON.stringify([{ kind: 'scatter', id: 2, xChannel: 'TC_Xforce', yChannel: 'TC_Yforce' }])
    expect(parseCharts(raw)).toEqual([
      { kind: 'scatter', id: 2, xChannel: 'TC_Xforce', yChannel: 'TC_Yforce', equalAspect: true, colorChannel: null },
    ])
  })

  it('coerces a non-boolean equalAspect back to the channel-pair default (false — no channels picked)', () => {
    const raw = JSON.stringify([{ kind: 'scatter', id: 2, xChannel: null, yChannel: null, equalAspect: 'yes' }])
    expect(parseCharts(raw)).toEqual([
      { kind: 'scatter', id: 2, xChannel: null, yChannel: null, equalAspect: false, colorChannel: null },
    ])
  })

  it('backfills colorChannel to null on pre-feature payloads (no such field) and coerces a non-string value', () => {
    const raw = JSON.stringify([
      { kind: 'scatter', id: 2, xChannel: 'RPM', yChannel: 'Vehicle_Speed', equalAspect: false },
      { kind: 'scatter', id: 3, xChannel: 'RPM', yChannel: 'Vehicle_Speed', equalAspect: false, colorChannel: 42 },
    ])
    expect(parseCharts(raw)).toEqual([
      { kind: 'scatter', id: 2, xChannel: 'RPM', yChannel: 'Vehicle_Speed', equalAspect: false, colorChannel: null },
      { kind: 'scatter', id: 3, xChannel: 'RPM', yChannel: 'Vehicle_Speed', equalAspect: false, colorChannel: null },
    ])
  })

  it('restores a gear-ratio chart and backfills an invalid mode to timeline', () => {
    expect(parseCharts(JSON.stringify([{ kind: 'gearRatio', id: 4, mode: 'weird' }]))).toEqual([
      { kind: 'gearRatio', id: 4, mode: 'timeline' },
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
      { kind: 'scatter', id: 3, xChannel: null, yChannel: 'RPM', equalAspect: false, colorChannel: null },
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
      { kind: 'scatter', id: 3, xChannel: 'TC_Xforce', yChannel: 'TC_Yforce', equalAspect: false, colorChannel: null },
      { kind: 'gearRatio', id: 4, mode: 'overlay' },
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
        { kind: 'scatter', id: 7, xChannel: null, yChannel: null, equalAspect: true, colorChannel: null },
      ]),
    ).toBe(8)
  })

  it('starts at 1 for an empty list', () => {
    expect(nextChartId([])).toBe(1)
  })
})
