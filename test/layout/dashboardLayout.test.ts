import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEY,
  GRID_COLS,
  STATIC_CARD_IDS,
  chartItemId,
  isChartItemId,
  defaultLayout,
  parseLayout,
  loadLayout,
  saveLayout,
  reconcileLayout,
} from '@/domain/layout/dashboardLayout'

/** Node's test environment has no real localStorage (Vitest runs with
 *  `environment: 'node'`), so stub an in-memory implementation — same
 *  approach other persistence tests in this repo use (see drivetrainStore.test.ts). */
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

describe('chartItemId / isChartItemId', () => {
  it('keys a chart card by the chart id, not an index', () => {
    expect(chartItemId(1)).toBe('chart-1')
    expect(chartItemId(42)).toBe('chart-42')
  })

  it('isChartItemId distinguishes chart cards from static cards', () => {
    expect(isChartItemId(chartItemId(3))).toBe(true)
    expect(isChartItemId(STATIC_CARD_IDS.map)).toBe(false)
    expect(isChartItemId(STATIC_CARD_IDS.lapTable)).toBe(false)
  })
})

describe('defaultLayout', () => {
  it('includes every static card id exactly once', () => {
    const layout = defaultLayout()
    const ids = layout.map((it) => it.i)
    for (const id of Object.values(STATIC_CARD_IDS)) {
      expect(ids.filter((x) => x === id)).toHaveLength(1)
    }
  })

  it('includes the initial chart (id 1) card', () => {
    const layout = defaultLayout()
    expect(layout.some((it) => it.i === chartItemId(1))).toBe(true)
  })

  it('every item fits within the grid column count and has positive size', () => {
    const layout = defaultLayout()
    for (const it of layout) {
      expect(it.w).toBeGreaterThan(0)
      expect(it.h).toBeGreaterThan(0)
      expect(it.x).toBeGreaterThanOrEqual(0)
      expect(it.x + it.w).toBeLessThanOrEqual(GRID_COLS)
    }
  })

  it('map card is at the top of the left column (x=0, y=0)', () => {
    const layout = defaultLayout()
    const map = layout.find((it) => it.i === STATIC_CARD_IDS.map)
    expect(map).toMatchObject({ x: 0, y: 0 })
  })
})

describe('parseLayout', () => {
  it('returns null for null/missing input', () => {
    expect(parseLayout(null)).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    expect(parseLayout('{not valid json')).toBeNull()
  })

  it('returns null for valid JSON that is not an array', () => {
    expect(parseLayout('{"foo": "bar"}')).toBeNull()
  })

  it('returns null for an empty array', () => {
    expect(parseLayout('[]')).toBeNull()
  })

  it('parses a valid layout array', () => {
    const items = [{ i: 'map', x: 0, y: 0, w: 5, h: 10 }]
    expect(parseLayout(JSON.stringify(items))).toEqual(items)
  })

  it('filters out malformed entries but keeps valid ones', () => {
    const raw = JSON.stringify([
      { i: 'map', x: 0, y: 0, w: 5, h: 10 },
      { i: 'bad', x: 'not-a-number', y: 0, w: 5, h: 10 },
      { x: 0, y: 0, w: 5, h: 10 }, // missing i
      null,
    ])
    const parsed = parseLayout(raw)
    expect(parsed).toEqual([{ i: 'map', x: 0, y: 0, w: 5, h: 10 }])
  })

  it('ignores extra unknown fields on an otherwise-valid item', () => {
    const raw = JSON.stringify([{ i: 'map', x: 0, y: 0, w: 5, h: 10, static: true, minW: 2 }])
    expect(parseLayout(raw)).toEqual([{ i: 'map', x: 0, y: 0, w: 5, h: 10 }])
  })
})

describe('loadLayout / saveLayout', () => {
  it('loadLayout falls back to defaultLayout when nothing is persisted', () => {
    expect(loadLayout()).toEqual(defaultLayout())
  })

  it('loadLayout falls back to defaultLayout on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    expect(loadLayout()).toEqual(defaultLayout())
  })

  it('saveLayout persists, and loadLayout restores it verbatim', () => {
    const custom = [{ i: 'map', x: 1, y: 2, w: 3, h: 4 }]
    saveLayout(custom)
    expect(loadLayout()).toEqual(custom)
  })

  it('saveLayout does not throw when localStorage.setItem fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    })
    expect(() => saveLayout(defaultLayout())).not.toThrow()
  })

  it('loadLayout does not throw when localStorage access itself throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('access denied')
      },
    })
    expect(loadLayout()).toEqual(defaultLayout())
  })
})

describe('reconcileLayout', () => {
  it('appends a default-positioned item for a newly added chart', () => {
    const layout = defaultLayout()
    const next = reconcileLayout(layout, [1, 2])
    expect(next.some((it) => it.i === chartItemId(2))).toBe(true)
    const added = next.find((it) => it.i === chartItemId(2))!
    expect(added.w).toBeGreaterThan(0)
    expect(added.h).toBeGreaterThan(0)
  })

  it('removes the layout entry for a chart that no longer exists', () => {
    const layout = defaultLayout()
    const next = reconcileLayout(layout, []) // chart 1 removed
    expect(next.some((it) => it.i === chartItemId(1))).toBe(false)
  })

  it('keeps every static card entry regardless of chartIds', () => {
    const layout = defaultLayout()
    const next = reconcileLayout(layout, [])
    for (const id of Object.values(STATIC_CARD_IDS)) {
      expect(next.some((it) => it.i === id)).toBe(true)
    }
  })

  it('is stable (idempotent) when chartIds already match the layout', () => {
    const layout = defaultLayout()
    const chartIds = [1]
    const next = reconcileLayout(layout, chartIds)
    expect(next).toEqual(layout)
  })

  it('preserves an existing chart item position instead of resetting it', () => {
    const layout = defaultLayout().map((it) =>
      it.i === chartItemId(1) ? { ...it, x: 9, y: 99, w: 3, h: 3 } : it,
    )
    const next = reconcileLayout(layout, [1])
    expect(next.find((it) => it.i === chartItemId(1))).toEqual({
      i: chartItemId(1),
      x: 9,
      y: 99,
      w: 3,
      h: 3,
    })
  })

  it('handles add + remove in the same reconcile (chart 1 removed, chart 3 added)', () => {
    const layout = defaultLayout()
    const next = reconcileLayout(layout, [3])
    expect(next.some((it) => it.i === chartItemId(1))).toBe(false)
    expect(next.some((it) => it.i === chartItemId(3))).toBe(true)
  })

  it('places a newly appended chart below the current max y (no overlap with existing rows)', () => {
    const layout = [{ i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 5, h: 10 }]
    const next = reconcileLayout(layout, [1])
    const added = next.find((it) => it.i === chartItemId(1))!
    expect(added.y).toBeGreaterThanOrEqual(10)
  })
})
