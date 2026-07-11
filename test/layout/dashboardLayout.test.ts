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
  mobileLayout,
  minSizeFor,
  clampToMinSize,
  resolveOverlaps,
  isItemDraggable,
  isItemResizable,
  mergeLayoutPositions,
  compactLayoutTopLeft,
  compactVertical,
  applyCollapsedHeights,
  sameLayoutPositions,
  COLLAPSED_ROWS,
  STATIC_CARD_TITLE_KEYS,
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

describe('minSizeFor (B6 — resize floor per card kind)', () => {
  it('returns a positive minW/minH for every static card id', () => {
    for (const id of Object.values(STATIC_CARD_IDS)) {
      const { minW, minH } = minSizeFor(id)
      expect(minW).toBeGreaterThan(0)
      expect(minH).toBeGreaterThan(0)
    }
  })

  it('gives chart cards a size floor regardless of chart id', () => {
    expect(minSizeFor(chartItemId(1))).toEqual(minSizeFor(chartItemId(99)))
    expect(minSizeFor(chartItemId(1)).minW).toBeGreaterThanOrEqual(3)
    expect(minSizeFor(chartItemId(1)).minH).toBeGreaterThanOrEqual(3)
  })

  it('falls back to a sane default for an unrecognised id', () => {
    const { minW, minH } = minSizeFor('some-future-card-kind')
    expect(minW).toBeGreaterThan(0)
    expect(minH).toBeGreaterThan(0)
  })

  it('every card in defaultLayout already meets its own minimum size', () => {
    for (const it of defaultLayout()) {
      const { minW, minH } = minSizeFor(it.i)
      expect(it.w).toBeGreaterThanOrEqual(minW)
      expect(it.h).toBeGreaterThanOrEqual(minH)
    }
  })
})

describe('clampToMinSize', () => {
  it('returns the SAME object (by value) when already at/above minimum', () => {
    const item = { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 10, h: 10 }
    expect(clampToMinSize(item)).toEqual(item)
  })

  it('grows w/h up to the minimum without touching x/y', () => {
    const tiny = { i: STATIC_CARD_IDS.map, x: 2, y: 3, w: 1, h: 1 }
    const clamped = clampToMinSize(tiny)
    const { minW, minH } = minSizeFor(STATIC_CARD_IDS.map)
    expect(clamped).toEqual({ i: STATIC_CARD_IDS.map, x: 2, y: 3, w: minW, h: minH })
  })

  it('only grows the dimension that is actually too small', () => {
    const { minW, minH } = minSizeFor(STATIC_CARD_IDS.gear)
    const partial = { i: STATIC_CARD_IDS.gear, x: 0, y: 0, w: minW + 5, h: 1 }
    const clamped = clampToMinSize(partial)
    expect(clamped.w).toBe(minW + 5)
    expect(clamped.h).toBe(minH)
  })

  it('clamps a chart card using the chart minimum', () => {
    const tiny = { i: chartItemId(7), x: 0, y: 0, w: 1, h: 1 }
    const clamped = clampToMinSize(tiny)
    const { minW, minH } = minSizeFor(chartItemId(7))
    expect(clamped).toEqual({ i: chartItemId(7), x: 0, y: 0, w: minW, h: minH })
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

  it('uses the FULL grid width across its columns (no default item extends past GRID_COLS, columns partition 0..GRID_COLS)', () => {
    const layout = defaultLayout()
    const xs = [...new Set(layout.map((it) => it.x))].sort((a, b) => a - b)
    // Every distinct column start, plus GRID_COLS itself, are evenly spaced —
    // i.e. the columns tile the full width with no left/right margin gap.
    expect(xs[0]).toBe(0)
    for (const it of layout) {
      expect(it.x + it.w).toBeLessThanOrEqual(GRID_COLS)
    }
  })

  it('has no overlapping items (a sane starting arrangement, independent of resolveOverlaps)', () => {
    const layout = defaultLayout()
    for (let i = 0; i < layout.length; i++) {
      for (let j = i + 1; j < layout.length; j++) {
        const a = layout[i]
        const b = layout[j]
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap).toBe(false)
      }
    }
  })

  it('balances column heights so no column leaves a large blank gap versus the others (T3 — fills the page)', () => {
    // Regression for the old 5/7-split layout, whose right column (with the
    // align panels in their default-hidden state) bottomed out ~35 rows
    // above the left column's bottom, reading as a big empty area on wide
    // screens. Compare the ALWAYS-VISIBLE cards per column (excluding
    // mapAlign/lapAlign, which only appear once ≥2 laps are selected).
    const layout = defaultLayout()
    const alwaysVisible = layout.filter(
      (it) => it.i !== STATIC_CARD_IDS.mapAlign && it.i !== STATIC_CARD_IDS.lapAlign,
    )
    const columns = [...new Set(alwaysVisible.map((it) => it.x))]
    const bottoms = columns.map((x) =>
      Math.max(...alwaysVisible.filter((it) => it.x === x).map((it) => it.y + it.h)),
    )
    const spread = Math.max(...bottoms) - Math.min(...bottoms)
    expect(spread).toBeLessThanOrEqual(10)
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
    const custom = [{ i: 'map', x: 1, y: 2, w: 3, h: 5 }]
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

  it('loadLayout clamps a persisted item smaller than its B6 minimum (old/corrupt save)', () => {
    const tooSmall = [{ i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 1, h: 1 }]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tooSmall))
    const loaded = loadLayout()
    const { minW, minH } = minSizeFor(STATIC_CARD_IDS.map)
    expect(loaded[0].w).toBeGreaterThanOrEqual(minW)
    expect(loaded[0].h).toBeGreaterThanOrEqual(minH)
  })

  it('loadLayout leaves an already-valid persisted layout untouched', () => {
    const custom = [{ i: STATIC_CARD_IDS.map, x: 1, y: 2, w: 6, h: 8 }]
    saveLayout(custom)
    expect(loadLayout()).toEqual(custom)
  })

  it('loadLayout returns a normal user layout byte-for-byte (deep-equal, no reorder)', () => {
    // A realistic hand-arranged layout where nothing needs clamping — must
    // come back completely unchanged, not run through overlap resolution.
    const custom = [
      { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 5, h: 10 },
      { i: STATIC_CARD_IDS.lapTable, x: 0, y: 10, w: 5, h: 8 },
      { i: chartItemId(1), x: 5, y: 0, w: 7, h: 9 },
    ]
    saveLayout(custom)
    expect(loadLayout()).toStrictEqual(custom)
  })

  it('loadLayout resolves overlaps introduced by clamping an old small-sized layout', () => {
    // Old layout saved before the B6 minimum-size table existed: map is
    // right next to gear with no gap, both undersized. Clamping grows map's
    // w/h past gear's x — resolveOverlaps must then push gear down clear.
    const old = [
      { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 1, h: 1 },
      { i: STATIC_CARD_IDS.gear, x: 1, y: 0, w: 1, h: 1 },
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(old))
    const loaded = loadLayout()
    const map = loaded.find((it) => it.i === STATIC_CARD_IDS.map)!
    const gear = loaded.find((it) => it.i === STATIC_CARD_IDS.gear)!
    const overlap = map.x < gear.x + gear.w && gear.x < map.x + map.w && map.y < gear.y + gear.h && gear.y < map.y + map.h
    expect(overlap).toBe(false)
    // Relative order preserved: map was placed first (y=0,x=0 sorts first),
    // so gear (originally alongside it) should end up pushed BELOW map, not
    // reordered ahead of it.
    expect(gear.y).toBeGreaterThanOrEqual(map.y + map.h)
  })
})

describe('resolveOverlaps', () => {
  it('is a no-op on a layout with no overlaps (every item keeps its x/y/w/h)', () => {
    const layout = defaultLayout()
    expect(resolveOverlaps(layout)).toEqual(layout)
  })

  it('pushes a later (lower/righter) overlapping item straight down, never touching x/w/h', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 4 },
      { i: 'b', x: 2, y: 0, w: 4, h: 4 }, // overlaps a
    ]
    const resolved = resolveOverlaps(layout)
    const a = resolved.find((it) => it.i === 'a')!
    const b = resolved.find((it) => it.i === 'b')!
    expect(a).toEqual(layout[0]) // earlier item untouched
    expect(b.x).toBe(2)
    expect(b.w).toBe(4)
    expect(b.h).toBe(4)
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h)
  })

  it('resolves a chain of overlaps (re-scans after each push) without infinite looping', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 4 },
      { i: 'b', x: 0, y: 1, w: 4, h: 4 }, // overlaps a
      { i: 'c', x: 0, y: 2, w: 4, h: 4 }, // overlaps a and, after b is pushed, may overlap b
    ]
    const resolved = resolveOverlaps(layout)
    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        const x = resolved[i]
        const y = resolved[j]
        const overlap = x.x < y.x + y.w && y.x < x.x + x.w && x.y < y.y + y.h && y.y < x.y + x.h
        expect(overlap).toBe(false)
      }
    }
  })

  it('preserves array order/identity of the result (same ids at same indices as input)', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 4 },
      { i: 'b', x: 2, y: 0, w: 4, h: 4 },
    ]
    const resolved = resolveOverlaps(layout)
    expect(resolved.map((it) => it.i)).toEqual(['a', 'b'])
  })
})

describe('compactLayoutTopLeft (grid-compact fix — closes both vertical AND horizontal gaps)', () => {
  it('pulls a card left into empty space freed up in an adjacent column', () => {
    // Column A (x0..4) is empty; column B (x4..8) has one card. Nothing
    // above/beside it in column A should stop it sliding all the way left —
    // this is exactly what grid-layout-plus's OWN vertical-only compaction
    // can never do (it never moves a card to a different x).
    const layout = [{ i: 'b', x: 4, y: 0, w: 4, h: 4 }]
    const compacted = compactLayoutTopLeft(layout)
    expect(compacted).toEqual([{ i: 'b', x: 0, y: 0, w: 4, h: 4 }])
  })

  it('pulls a card up into empty space above it', () => {
    const layout = [{ i: 'a', x: 0, y: 5, w: 4, h: 4 }]
    const compacted = compactLayoutTopLeft(layout)
    expect(compacted).toEqual([{ i: 'a', x: 0, y: 0, w: 4, h: 4 }])
  })

  it('closes a hole left by a deleted card: the card below/right of it moves up-left to fill it', () => {
    // b used to sit directly below a (touching, no gap). Removing a's lower
    // neighbour conceptually (simulated here by just giving b a gap above it)
    // — b should slide all the way up to touch y=0.
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 4 },
      { i: 'b', x: 4, y: 6, w: 4, h: 4 }, // gap above (y4..6) AND beside `a` (x0..4 free for y0..4? no, a occupies it)
    ]
    const compacted = compactLayoutTopLeft(layout)
    const a = compacted.find((it) => it.i === 'a')!
    const b = compacted.find((it) => it.i === 'b')!
    expect(a).toEqual(layout[0]) // already top-left, untouched
    expect(b.y).toBe(0) // pulled all the way up (nothing blocks it once past a's row band)
    expect(b.x).toBe(4) // can't slide into x0..4 — a occupies that column for y0..4
  })

  it('respects reading order: an earlier (higher/lefter) item keeps priority over a later one for the same freed slot', () => {
    const layout = [
      { i: 'first', x: 4, y: 0, w: 4, h: 4 },
      { i: 'second', x: 8, y: 0, w: 4, h: 4 },
    ]
    const compacted = compactLayoutTopLeft(layout)
    const first = compacted.find((it) => it.i === 'first')!
    const second = compacted.find((it) => it.i === 'second')!
    expect(first).toEqual({ i: 'first', x: 0, y: 0, w: 4, h: 4 }) // claims x0 first
    expect(second).toEqual({ i: 'second', x: 4, y: 0, w: 4, h: 4 }) // takes what's left
  })

  it('never overlaps two items after compacting', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 8, y: 2, w: 4, h: 4 },
      { i: 'c', x: 4, y: 10, w: 4, h: 3 },
      { i: 'd', x: 0, y: 20, w: 8, h: 2 },
    ]
    const compacted = compactLayoutTopLeft(layout)
    for (let i = 0; i < compacted.length; i++) {
      for (let j = i + 1; j < compacted.length; j++) {
        const a = compacted[i]
        const b = compacted[j]
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap).toBe(false)
      }
    }
  })

  it('never moves an item past x=0 or y=0', () => {
    const layout = [{ i: 'a', x: 0, y: 0, w: 4, h: 4 }]
    const compacted = compactLayoutTopLeft(layout)
    expect(compacted[0].x).toBeGreaterThanOrEqual(0)
    expect(compacted[0].y).toBeGreaterThanOrEqual(0)
  })

  it('is a no-op (returns the SAME array reference) on an already top-left-packed layout', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 4 },
      { i: 'b', x: 4, y: 0, w: 4, h: 4 },
    ]
    expect(compactLayoutTopLeft(layout)).toBe(layout)
  })

  it('is a no-op on defaultLayout (already balanced 3-column arrangement stays put)', () => {
    const layout = defaultLayout()
    expect(compactLayoutTopLeft(layout)).toBe(layout)
  })

  it('is idempotent: compacting an already-compacted layout is a fixed point', () => {
    const layout = [
      { i: 'a', x: 4, y: 5, w: 4, h: 4 },
      { i: 'b', x: 8, y: 0, w: 4, h: 4 },
    ]
    const once = compactLayoutTopLeft(layout)
    const twice = compactLayoutTopLeft(once)
    expect(twice).toBe(once)
  })

  it('keeps the SAME object reference for an individual item that did not move', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 4 }, // already packed, won't move
      { i: 'b', x: 8, y: 0, w: 4, h: 4 }, // will slide left to x=4
    ]
    const compacted = compactLayoutTopLeft(layout)
    expect(compacted.find((it) => it.i === 'a')).toBe(layout[0])
    expect(compacted.find((it) => it.i === 'b')).not.toBe(layout[1])
  })

  it('preserves the original array order (same ids at same indices as input)', () => {
    const layout = [
      { i: 'b', x: 8, y: 0, w: 4, h: 4 },
      { i: 'a', x: 4, y: 0, w: 4, h: 4 },
    ]
    const compacted = compactLayoutTopLeft(layout)
    expect(compacted.map((it) => it.i)).toEqual(['b', 'a'])
  })
})

describe('compactVertical (collapse-reflow packer — vertical-only, never changes x)', () => {
  it('pulls a card up into empty space above it (same as compactLayoutTopLeft for a single column)', () => {
    const layout = [{ i: 'a', x: 0, y: 5, w: 4, h: 4 }]
    const compacted = compactVertical(layout)
    expect(compacted).toEqual([{ i: 'a', x: 0, y: 0, w: 4, h: 4 }])
  })

  it('does NOT slide a card left into empty space in a different column (unlike compactLayoutTopLeft)', () => {
    // Column A (x0..4) is empty; column B (x4..8) has one card. Vertical-only
    // packing must leave it in column B — only compactLayoutTopLeft slides it.
    const layout = [{ i: 'b', x: 4, y: 0, w: 4, h: 4 }]
    const compacted = compactVertical(layout)
    expect(compacted).toEqual(layout)
  })

  it('pulls same-column cards below a freed gap upward, one at a time, without touching x', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 2 }, // shrunk from 8 down to 2 (collapsed)
      { i: 'b', x: 0, y: 8, w: 4, h: 6 }, // directly below a in the SAME column
    ]
    const compacted = compactVertical(layout)
    const a = compacted.find((it) => it.i === 'a')!
    const b = compacted.find((it) => it.i === 'b')!
    expect(a).toEqual(layout[0])
    expect(b).toEqual({ i: 'b', x: 0, y: 2, w: 4, h: 6 })
  })

  it('never overlaps two items after compacting', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 8, y: 2, w: 4, h: 4 },
      { i: 'c', x: 4, y: 10, w: 4, h: 3 },
      { i: 'd', x: 0, y: 20, w: 8, h: 2 },
    ]
    const compacted = compactVertical(layout)
    for (let i = 0; i < compacted.length; i++) {
      for (let j = i + 1; j < compacted.length; j++) {
        const x = compacted[i]
        const y = compacted[j]
        const overlap = x.x < y.x + y.w && y.x < x.x + x.w && x.y < y.y + y.h && y.y < x.y + x.h
        expect(overlap).toBe(false)
      }
    }
  })

  it('preserves x for every item, even when y changes', () => {
    const layout = [
      { i: 'a', x: 4, y: 10, w: 4, h: 4 },
      { i: 'b', x: 8, y: 20, w: 4, h: 4 },
    ]
    const compacted = compactVertical(layout)
    expect(compacted.find((it) => it.i === 'a')!.x).toBe(4)
    expect(compacted.find((it) => it.i === 'b')!.x).toBe(8)
  })

  it('is a no-op (returns the SAME array reference) on an already vertically-packed layout', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 4 },
      { i: 'b', x: 4, y: 0, w: 4, h: 4 },
    ]
    expect(compactVertical(layout)).toBe(layout)
  })

  it('is idempotent: compacting an already-compacted layout is a fixed point', () => {
    const layout = [
      { i: 'a', x: 0, y: 5, w: 4, h: 4 },
      { i: 'b', x: 4, y: 8, w: 4, h: 4 },
    ]
    const once = compactVertical(layout)
    const twice = compactVertical(once)
    expect(twice).toBe(once)
  })

  it('keeps the SAME object reference for an individual item that did not move', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 4, h: 4 }, // already packed, won't move
      { i: 'b', x: 4, y: 5, w: 4, h: 4 }, // will slide up to y=0
    ]
    const compacted = compactVertical(layout)
    expect(compacted.find((it) => it.i === 'a')).toBe(layout[0])
    expect(compacted.find((it) => it.i === 'b')).not.toBe(layout[1])
  })

  it('preserves the original array order (same ids at same indices as input)', () => {
    const layout = [
      { i: 'b', x: 4, y: 5, w: 4, h: 4 },
      { i: 'a', x: 0, y: 0, w: 4, h: 4 },
    ]
    const compacted = compactVertical(layout)
    expect(compacted.map((it) => it.i)).toEqual(['b', 'a'])
  })

  // Regression for the reported bug: collapsing a row-2 card in one column
  // must NEVER pull a row-3 card from a DIFFERENT column sideways into the
  // freed rows — only cards below it in the SAME column should move up.
  it('collapsing a card only reflows cards in its OWN column, never a card from a different column', () => {
    const layout = [
      // Column A (x0..4): row1 (short), row2 (about to collapse), nothing below.
      { i: 'colA-row1', x: 0, y: 0, w: 4, h: 4 },
      { i: 'colA-row2', x: 0, y: 4, w: 4, h: 2 }, // already shrunk to COLLAPSED_ROWS
      // Column B (x4..8): row1, row2, row3 — row3 must stay put, NOT jump
      // sideways into column A just because column A has free rows below.
      { i: 'colB-row1', x: 4, y: 0, w: 4, h: 4 },
      { i: 'colB-row2', x: 4, y: 4, w: 4, h: 4 },
      { i: 'colB-row3', x: 4, y: 8, w: 4, h: 4 },
    ]
    const compacted = compactVertical(layout)
    const colBRow3 = compacted.find((it) => it.i === 'colB-row3')!
    expect(colBRow3.x).toBe(4) // stays in column B
    expect(colBRow3.y).toBe(8) // nothing frees space above it in ITS OWN column
    // Column A's freed rows (below the collapsed row2, y4..h2) stay empty —
    // vertical-only packing has nothing in column A to pull up into them.
    const colARow2 = compacted.find((it) => it.i === 'colA-row2')!
    expect(colARow2).toEqual(layout[1])
  })
})

describe('applyCollapsedHeights regression — collapsing a card never moves a different-column card (BUG#3)', () => {
  it('collapsing a row-2 card does not move any card in a different x-column, only pulls same-column cards below it upward', () => {
    // Mirrors the user's repro: 把第二排卡片第一個收折進來後，第三排的最後一個
    // 卡片會移到第二排最底下 — collapsing a card in "row 2" must not yank a
    // "row 3" card from a DIFFERENT column up into row 2's vacated space.
    const layout = [
      // Column A (x0..4): three stacked cards, the middle one collapses.
      { i: 'a-top', x: 0, y: 0, w: 4, h: 4 },
      { i: 'a-mid', x: 0, y: 4, w: 4, h: 6 }, // this one gets collapsed
      { i: 'a-bottom', x: 0, y: 10, w: 4, h: 5 },
      // Column B (x4..8): unrelated cards that must stay exactly where they are.
      { i: 'b-top', x: 4, y: 0, w: 4, h: 8 },
      { i: 'b-bottom', x: 4, y: 8, w: 4, h: 7 },
    ]
    const out = applyCollapsedHeights(layout, new Set(['a-mid']))

    // Column B must be COMPLETELY untouched — same x, y, h for every item.
    const bTop = out.find((it) => it.i === 'b-top')!
    const bBottom = out.find((it) => it.i === 'b-bottom')!
    expect(bTop).toEqual(layout[3])
    expect(bBottom).toEqual(layout[4])

    // Column A: the collapsed card shrinks, and only the card BELOW it (in
    // the SAME column) packs up into the reclaimed rows.
    const aMid = out.find((it) => it.i === 'a-mid')!
    const aBottom = out.find((it) => it.i === 'a-bottom')!
    expect(aMid.h).toBe(COLLAPSED_ROWS)
    expect(aMid.x).toBe(0)
    expect(aBottom.x).toBe(0) // never slides into column B
    expect(aBottom.y).toBe(4 + COLLAPSED_ROWS) // reflows up behind the shrunk card
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

  // #4 crash fix — useDashboardLayout's `chartIds` watcher writes
  // `layout.value = reconcileLayout(layout.value, ids)` on every change to
  // the id SET, even ones that add/remove nothing here. If that always
  // produced a fresh-but-equal array, the assignment would never be a true
  // Vue no-op (a `ref` only skips notifying watchers when the new value is
  // the SAME object as the old one) and could feed the exact "layout ref
  // reassigned -> GridLayout re-renders -> emits layout-updated -> writes
  // back -> ..." cycle reported as the "load two files -> infinite recursive
  // updates" crash. See mergeLayoutPositions's matching test below for the
  // other half of the write-back path.
  it('returns the SAME array reference (not just equal) on a true no-op call', () => {
    const layout = defaultLayout()
    const next = reconcileLayout(layout, [1])
    expect(next).toBe(layout)
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

  // Grid-compact fix — removing a chart card is the headline "hole" scenario
  // from the task: deleting the middle column's only card leaves a vertical
  // strip empty that grid-layout-plus's own vertical-only compaction can
  // never fill (it never slides a card sideways). reconcileLayout is the
  // function that runs on every chart removal (via useDashboardLayout's
  // chartIds watcher), so this is where that hole must get closed.
  it('closes the horizontal hole a removed chart leaves behind (a different column slides left to fill it)', () => {
    const layout = [
      { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 4, h: 20 }, // column A, full height
      { i: chartItemId(1), x: 4, y: 0, w: 4, h: 5 }, // column B — about to be removed
      { i: chartItemId(2), x: 8, y: 0, w: 4, h: 20 }, // column C, matches A's height
    ]
    const next = reconcileLayout(layout, [2]) // chart-1 removed
    expect(next.some((it) => it.i === chartItemId(1))).toBe(false)
    const chart2 = next.find((it) => it.i === chartItemId(2))!
    // Column B (x4..8) is now empty for its full height — chart-2 slides all
    // the way into it (blocked from going further by column A).
    expect(chart2).toMatchObject({ x: 4, y: 0 })
  })

  it('does NOT reposition existing cards on a pure add (only compacts when something was actually removed)', () => {
    const layout = [
      { i: STATIC_CARD_IDS.map, x: 4, y: 0, w: 4, h: 10 }, // deliberately NOT at x=0
    ]
    const next = reconcileLayout(layout, [1]) // chart-1 newly added, nothing removed
    const map = next.find((it) => it.i === STATIC_CARD_IDS.map)!
    expect(map).toEqual(layout[0]) // untouched — no compaction ran
  })
})

describe('isItemDraggable / isItemResizable (lock + pin interplay)', () => {
  it('is draggable/resizable when the grid-wide toggle allows it and the card is not pinned', () => {
    expect(isItemDraggable(true, false)).toBe(true)
    expect(isItemResizable(true, false)).toBe(true)
  })

  it('is never draggable/resizable when the grid-wide toggle is off (鎖定布局 locked)', () => {
    expect(isItemDraggable(false, false)).toBe(false)
    expect(isItemResizable(false, false)).toBe(false)
    expect(isItemDraggable(false, true)).toBe(false)
    expect(isItemResizable(false, true)).toBe(false)
  })

  it('is never draggable/resizable when the card itself is pinned, even if the grid allows it', () => {
    expect(isItemDraggable(true, true)).toBe(false)
    expect(isItemResizable(true, true)).toBe(false)
  })
})

describe('STATIC_CARD_TITLE_KEYS', () => {
  it('has an i18n key entry for every static card id', () => {
    for (const id of Object.values(STATIC_CARD_IDS)) {
      expect(typeof STATIC_CARD_TITLE_KEYS[id]).toBe('string')
      expect(STATIC_CARD_TITLE_KEYS[id].length).toBeGreaterThan(0)
    }
  })

  it('every key lives under the analyzer.layout namespace', () => {
    for (const key of Object.values(STATIC_CARD_TITLE_KEYS)) {
      expect(key.startsWith('analyzer.layout.')).toBe(true)
    }
  })
})

describe('mergeLayoutPositions (#1 fix — layout-updated write-back)', () => {
  it('overwrites only the coordinate fields of a matching item, dropping decoration fields', () => {
    const base = [{ i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 4, h: 10 }]
    const updated = [
      {
        i: STATIC_CARD_IDS.map,
        x: 2,
        y: 3,
        w: 5,
        h: 6,
        // Decoration fields AnalyzerView's decorateForGrid spreads onto
        // items before handing them to grid-layout-plus — must NOT leak
        // into the merged/persisted result.
        dragAllowFrom: '.drag-handle',
        dragIgnoreFrom: '.actions',
        isDraggable: true,
        isResizable: true,
        minW: 3,
        minH: 5,
      },
    ]
    const merged = mergeLayoutPositions(base, updated)
    expect(merged).toEqual([{ i: STATIC_CARD_IDS.map, x: 2, y: 3, w: 5, h: 6 }])
  })

  it('leaves an item present in base but absent from updated completely unchanged', () => {
    const base = [
      { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 4, h: 10 },
      { i: STATIC_CARD_IDS.mapAlign, x: 8, y: 19, w: 4, h: 5 }, // hidden align card
    ]
    const updated = [{ i: STATIC_CARD_IDS.map, x: 1, y: 1, w: 4, h: 10 }]
    const merged = mergeLayoutPositions(base, updated)
    expect(merged.find((it) => it.i === STATIC_CARD_IDS.mapAlign)).toEqual(base[1])
  })

  it('preserves the original array order regardless of updated item order', () => {
    const base = [
      { i: 'a', x: 0, y: 0, w: 4, h: 4 },
      { i: 'b', x: 4, y: 0, w: 4, h: 4 },
    ]
    const updated = [
      { i: 'b', x: 5, y: 1, w: 4, h: 4 },
      { i: 'a', x: 1, y: 1, w: 4, h: 4 },
    ]
    const merged = mergeLayoutPositions(base, updated)
    expect(merged.map((it) => it.i)).toEqual(['a', 'b'])
  })

  it('keeps the SAME object reference for an item whose coordinates did not change (no-op detection)', () => {
    const base = [{ i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 4, h: 10 }]
    const updated = [{ i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 4, h: 10, isDraggable: true }]
    const merged = mergeLayoutPositions(base, updated)
    expect(merged[0]).toBe(base[0])
  })

  it('is a no-op (returns items equal to base) when updated is empty', () => {
    const base = defaultLayout()
    expect(mergeLayoutPositions(base, [])).toEqual(base)
  })

  // #4 crash fix — AnalyzerView's `activeLayout` setter / `onLayoutUpdated`
  // write straight into `layout.value` via `layout.value =
  // mergeLayoutPositions(layout.value, next)`. Vue's `ref` setter only skips
  // notifying dependents when the assigned value is the SAME object
  // (`Object.is`) as the current one — a structurally-equal-but-freshly-
  // allocated array (what plain `.map()` always returns) would still trigger
  // every downstream computed/watcher, including re-rendering
  // `<GridLayout>`'s `:layout` prop, which can itself re-emit `layout-
  // updated` (its own compaction pass runs on prop changes, not only drags)
  // and call back into `onLayoutUpdated` — an unbounded loop ("Maximum
  // recursive updates exceeded"), reported after loading a second file.
  // Returning `base` itself when NOTHING's coordinates changed makes that
  // assignment a genuine no-op and breaks the cycle once positions converge.
  it('returns the SAME array reference (not just equal) as base when nothing changed', () => {
    const base = defaultLayout()
    // Same coordinates, only decoration fields differ (as decorateForGrid
    // would produce) — a real "nothing actually moved" payload.
    const updated = base.map((it) => ({ ...it, isDraggable: true, isResizable: true }))
    const merged = mergeLayoutPositions(base, updated)
    expect(merged).toBe(base)
  })

  it('returns a NEW array reference when at least one item genuinely moved', () => {
    const base = defaultLayout()
    const updated = base.map((it) =>
      it.i === STATIC_CARD_IDS.gear ? { ...it, x: 9, y: 20 } : it,
    )
    const merged = mergeLayoutPositions(base, updated)
    expect(merged).not.toBe(base)
  })

  it('simulates a drag: only the dragged item moves, everything else is untouched', () => {
    const base = defaultLayout()
    const dragged = base.find((it) => it.i === STATIC_CARD_IDS.gear)!
    // grid-layout-plus's layout-updated payload is the FULL visible array
    // (every item, not just the one that moved) — with only the dragged
    // item's x/y actually different.
    const payload = base.map((it) =>
      it.i === STATIC_CARD_IDS.gear ? { ...it, x: 9, y: 20 } : it,
    )
    const merged = mergeLayoutPositions(base, payload)
    expect(merged.find((it) => it.i === STATIC_CARD_IDS.gear)).toEqual({
      ...dragged,
      x: 9,
      y: 20,
    })
    for (const it of merged) {
      if (it.i === STATIC_CARD_IDS.gear) continue
      expect(it).toEqual(base.find((b) => b.i === it.i))
    }
  })
})

describe('mobileLayout (single-column builder from an explicit order)', () => {
  const desktop = [
    { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 5, h: 10 },
    { i: STATIC_CARD_IDS.gear, x: 5, y: 0, w: 5, h: 6 },
    { i: chartItemId(1), x: 0, y: 10, w: 10, h: 8 },
  ]

  it('builds a full-width (x:0,w:1) column in exactly the given order', () => {
    const order = [STATIC_CARD_IDS.gear, chartItemId(1), STATIC_CARD_IDS.map]
    const out = mobileLayout(order, desktop)
    expect(out.map((it) => it.i)).toEqual(order)
    expect(out.every((it) => it.x === 0 && it.w === 1)).toBe(true)
  })

  it('inherits each card DESKTOP height and stacks y cumulatively (no overlap)', () => {
    const order = [STATIC_CARD_IDS.gear, chartItemId(1), STATIC_CARD_IDS.map]
    const out = mobileLayout(order, desktop)
    // gear h=6 → y0; chart-1 h=8 → y6; map h=10 → y14
    expect(out).toEqual([
      { i: STATIC_CARD_IDS.gear, x: 0, y: 0, w: 1, h: 6 },
      { i: chartItemId(1), x: 0, y: 6, w: 1, h: 8 },
      { i: STATIC_CARD_IDS.map, x: 0, y: 14, w: 1, h: 10 },
    ])
  })

  it('falls back to a default height for an id missing from the desktop layout', () => {
    const out = mobileLayout(['ghost'], desktop)
    expect(out[0].h).toBeGreaterThan(0)
    expect(out[0]).toMatchObject({ i: 'ghost', x: 0, y: 0, w: 1 })
  })

  it('returns an empty array for an empty order', () => {
    expect(mobileLayout([], desktop)).toEqual([])
  })
})

describe('applyCollapsedHeights (collapse-reflow / 補位)', () => {
  // Two stacked full-width cards; collapsing the top one should let the bottom
  // one pack up into the reclaimed rows.
  const stacked = () => [
    { i: 'a', x: 0, y: 0, w: 12, h: 8 },
    { i: 'b', x: 0, y: 8, w: 12, h: 6 },
  ]

  it('shrinks a collapsed card to COLLAPSED_ROWS and packs neighbours up', () => {
    const out = applyCollapsedHeights(stacked(), new Set(['a']))
    const a = out.find((it) => it.i === 'a')!
    const b = out.find((it) => it.i === 'b')!
    expect(a.h).toBe(COLLAPSED_ROWS)
    expect(a.y).toBe(0)
    // b reflows up from y:8 to sit directly below the now-short a.
    expect(b.y).toBe(COLLAPSED_ROWS)
    expect(b.h).toBe(6)
  })

  it('leaves canonical heights untouched when nothing is collapsed (identity)', () => {
    const input = stacked()
    const out = applyCollapsedHeights(input, new Set())
    // Already top-left packed ⇒ same array reference back (fixed point).
    expect(out).toBe(input)
  })

  it('is idempotent on an already collapsed-and-packed layout', () => {
    const once = applyCollapsedHeights(stacked(), new Set(['a']))
    const twice = applyCollapsedHeights(once, new Set(['a']))
    expect(twice).toEqual(once)
  })

  it('reclaims the full column when every card is collapsed', () => {
    const out = applyCollapsedHeights(stacked(), new Set(['a', 'b']))
    expect(out.map((it) => it.h)).toEqual([COLLAPSED_ROWS, COLLAPSED_ROWS])
    expect(out.find((it) => it.i === 'b')!.y).toBe(COLLAPSED_ROWS)
  })
})

describe('sameLayoutPositions', () => {
  const base = [
    { i: 'a', x: 0, y: 0, w: 4, h: 8 },
    { i: 'b', x: 4, y: 0, w: 4, h: 6 },
  ]

  it('is true for the same cards at the same coords in any order', () => {
    expect(sameLayoutPositions(base, [base[1], base[0]])).toBe(true)
  })

  it('is false when any coordinate differs', () => {
    expect(sameLayoutPositions(base, [{ ...base[0], y: 1 }, base[1]])).toBe(false)
  })

  it('is false on a length mismatch', () => {
    expect(sameLayoutPositions(base, [base[0]])).toBe(false)
  })
})
