// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useCssGridDashboardDrag } from '@/composables/useCssGridDashboardDrag'
import type { DashboardLayoutItem } from '@/domain/layout/dashboardLayout'

// Same 12-col / 24 row-height / 12px margin metrics gridGutter.test.ts and
// useGridGutters.test.ts already use, so pixel-step arithmetic here is easy
// to cross-check against those already-trusted suites.
const COLS = 12
const ROW_HEIGHT = 24
const MARGIN_X = 12
const MARGIN_Y = 12
const CONTAINER_WIDTH = 1224 // (1224 - 12*13)/12 = 89 exactly

function colStep(): number {
  const colWidth = (CONTAINER_WIDTH - MARGIN_X * (COLS + 1)) / COLS
  return colWidth + MARGIN_X // 101
}
function rowStep(): number {
  return ROW_HEIGHT + MARGIN_Y // 36
}

/** happy-dom's ResizeObserver never fires from real layout — same fake used
 *  by useGridGutters.test.ts, reporting a controlled width synchronously. */
class FakeResizeObserver {
  private readonly cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(): void {
    this.cb([{ contentRect: { width: CONTAINER_WIDTH } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  unobserve(): void {}
  disconnect(): void {}
}

let rafCallback: FrameRequestCallback | null = null
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  rafCallback = null
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallback = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafCallback = null
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** Runs whatever rAF callback is currently pending (if any) — stands in for
 *  the browser firing the next animation frame. */
function flushRaf(): void {
  const cb = rafCallback
  rafCallback = null
  cb?.(0)
}

function mountHarness(
  initialLayout: DashboardLayoutItem[],
  opts: { pinnedIds?: string[]; cols?: number; draggable?: boolean; marginX?: number } = {},
) {
  let result!: ReturnType<typeof useCssGridDashboardDrag>
  const layoutRef = ref(initialLayout)
  const pinnedIdsRef = ref(opts.pinnedIds ?? [])
  const colsRef = ref(opts.cols ?? COLS)
  const draggableRef = ref(opts.draggable ?? true)
  const marginXRef = ref(opts.marginX ?? MARGIN_X)
  const onCommit = vi.fn()
  const Harness = defineComponent({
    setup() {
      result = useCssGridDashboardDrag({
        layout: computed(() => layoutRef.value),
        pinnedIds: computed(() => pinnedIdsRef.value),
        cols: computed(() => colsRef.value),
        rowHeight: ROW_HEIGHT,
        marginX: computed(() => marginXRef.value),
        marginY: MARGIN_Y,
        draggable: computed(() => draggableRef.value),
        onCommit,
      })
      return () => h('div')
    },
  })
  const wrapper = mount(Harness)
  return { wrapper, result, layoutRef, pinnedIdsRef, colsRef, draggableRef, marginXRef, onCommit }
}

describe('useCssGridDashboardDrag', () => {
  it('previewLayout equals the input layout when nothing is being dragged', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ]
    const { result } = mountHarness(items)
    expect(result.previewLayout.value).toEqual(items)
    expect(result.draggingId.value).toBeNull()
    expect(result.dragOffsetPx.value).toBeNull()
  })

  it('isItemDraggableNow is true for an ordinary card when the grid-wide toggle is on', () => {
    const { result } = mountHarness([{ i: 'a', x: 0, y: 0, w: 4, h: 6 }])
    expect(result.isItemDraggableNow('a')).toBe(true)
  })

  it('isItemDraggableNow is false when the grid-wide toggle is off (鎖定布局)', () => {
    const { result } = mountHarness([{ i: 'a', x: 0, y: 0, w: 4, h: 6 }], { draggable: false })
    expect(result.isItemDraggableNow('a')).toBe(false)
  })

  it('isItemDraggableNow is false for a pinned card even when the grid-wide toggle is on', () => {
    const { result } = mountHarness([{ i: 'a', x: 0, y: 0, w: 4, h: 6 }], { pinnedIds: ['a'] })
    expect(result.isItemDraggableNow('a')).toBe(false)
  })

  it('onCardDragStart is a no-op for a non-draggable (pinned) card — no preview, no draggingId', async () => {
    const items: DashboardLayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 4, h: 6 }]
    const { result } = mountHarness(items, { pinnedIds: ['a'] })
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardDragStart('a', 100, 100)
    expect(result.draggingId.value).toBeNull()
    expect(result.previewLayout.value).toEqual(items)
  })

  it('onCardDragStart is a no-op while the grid-wide toggle is off', async () => {
    const items: DashboardLayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 4, h: 6 }]
    const { result } = mountHarness(items, { draggable: false })
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardDragStart('a', 100, 100)
    expect(result.draggingId.value).toBeNull()
  })

  it('starting a drag sets draggingId, and a zero move leaves previewLayout unchanged', async () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ]
    const { result } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardDragStart('a', 100, 100)
    expect(result.draggingId.value).toBe('a')
    expect(result.previewLayout.value).toEqual(items)
  })

  // Three FULL-WIDTH (w=12=cols) rows stacked top-to-bottom — same shape as
  // the mobile 1-column case below, just at desktop metrics, so the ONLY axis
  // in play is y (x can never move: `while item.x > 0` in compactLayoutTopLeft
  // is trivially false when w already equals cols). This sidesteps a real
  // property of the SHARED (already shipped, dashboardLayout.test.ts-covered)
  // compactLayoutTopLeft: a lone/unblocked card dragged into open space always
  // gravitates straight back to (0,0) once compacted, so a 2-item side-by-side
  // "swap" scenario doesn't actually produce a stable, hand-traceable result —
  // this 3-item vertical stack does (each item's rest position is blocked by
  // a REAL neighbour, not empty space), matching a genuine reflow-after-drag.
  function threeStackedRows(): DashboardLayoutItem[] {
    return [
      { i: 'a', x: 0, y: 0, w: 12, h: 6 },
      { i: 'b', x: 0, y: 6, w: 12, h: 8 },
      { i: 'c', x: 0, y: 14, w: 12, h: 5 },
    ]
  }
  // Dragging 'c' (bottom, y:14) up by exactly 14 rows lands its candidate at
  // y:0 — tying with 'a' (also y:0, never moved). resolveOverlaps' sort is
  // stable, so the tie resolves in ORIGINAL array order (a before c), meaning
  // 'a' still settles first at y:0 and 'c' gets pushed to directly beneath it
  // (y:6) — 'b' then gets pushed beneath THAT (y:11) — net effect: c moves
  // from last to MIDDLE (between a and b), a genuine, unambiguous reorder.
  const DRAG_C_ABOVE_B_DY = -14 * rowStep()

  it('moving a card up past a sibling reflows the preview (a genuine reorder) after the rAF frame runs', async () => {
    const items = threeStackedRows()
    const { result } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardDragStart('c', 0, 0)

    result.onCardDragMove(0, DRAG_C_ABOVE_B_DY)
    // Not yet applied — coalesced until the rAF frame fires.
    expect(result.previewLayout.value.find((it) => it.i === 'c')).toMatchObject({ y: 14 })

    flushRaf()
    const preview = result.previewLayout.value
    expect(preview.find((it) => it.i === 'a')).toMatchObject({ y: 0 })
    expect(preview.find((it) => it.i === 'c')).toMatchObject({ y: 6 })
    expect(preview.find((it) => it.i === 'b')).toMatchObject({ y: 11 })
  })

  it('coalesces several moves within one frame into a single reflow (only the LATEST position matters)', async () => {
    const items = threeStackedRows()
    const { result } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardDragStart('c', 0, 0)

    // Several intermediate positions, none of which is where the drag
    // actually ends up.
    result.onCardDragMove(0, -rowStep())
    result.onCardDragMove(0, rowStep() * 3)
    result.onCardDragMove(0, DRAG_C_ABOVE_B_DY)
    flushRaf()

    const preview = result.previewLayout.value
    expect(preview.find((it) => it.i === 'c')).toMatchObject({ y: 6 })
    expect(preview.find((it) => it.i === 'b')).toMatchObject({ y: 11 })
    // requestAnimationFrame should only have been scheduled ONCE across the
    // three moves (a second call while one is already pending is a no-op),
    // and the loop shouldn't still have a frame queued after flushing.
    expect(rafCallback).toBeNull()
  })

  it('dragOffsetPx follows the raw pixel delta (not grid-snapped) once a frame has flushed', async () => {
    const items: DashboardLayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 4, h: 6 }]
    const { result } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardDragStart('a', 10, 20)
    result.onCardDragMove(37, 65)
    flushRaf()

    expect(result.dragOffsetPx.value).toEqual({ id: 'a', dxPx: 27, dyPx: 45 })
  })

  it('committing (pointerup) calls onCommit with the settled preview and clears drag state', async () => {
    const items = threeStackedRows()
    const { result, onCommit } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardDragStart('c', 0, 0)
    result.onCardDragMove(0, DRAG_C_ABOVE_B_DY)
    flushRaf()

    result.onCardDragEnd(true)

    expect(onCommit).toHaveBeenCalledTimes(1)
    const committed = onCommit.mock.calls[0][0] as DashboardLayoutItem[]
    expect(committed.find((it) => it.i === 'a')).toMatchObject({ y: 0 })
    expect(committed.find((it) => it.i === 'c')).toMatchObject({ y: 6 })
    expect(committed.find((it) => it.i === 'b')).toMatchObject({ y: 11 })
    expect(result.draggingId.value).toBeNull()
    expect(result.dragOffsetPx.value).toBeNull()
    // Preview reverts to the (unchanged) input `layout` now that nothing is
    // dragging — the caller is expected to feed the COMMITTED result back in
    // as a new `layout` in the real app (AnalyzerView re-renders from
    // persisted state), which this harness doesn't simulate.
    expect(result.previewLayout.value).toEqual(items)
  })

  it('aborting (committed: false) does NOT call onCommit and discards the preview', async () => {
    const items = threeStackedRows()
    const { result, onCommit } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardDragStart('c', 0, 0)
    result.onCardDragMove(0, DRAG_C_ABOVE_B_DY)
    flushRaf()

    result.onCardDragEnd(false)

    expect(onCommit).not.toHaveBeenCalled()
    expect(result.draggingId.value).toBeNull()
    expect(result.previewLayout.value).toEqual(items)
  })

  it('flushes a pending (not-yet-rAF-fired) move before committing, so the very latest position is never lost', async () => {
    const items = threeStackedRows()
    const { result, onCommit } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardDragStart('c', 0, 0)
    result.onCardDragMove(0, DRAG_C_ABOVE_B_DY)
    // No flushRaf() here — the drag ends before the browser ever painted a frame.
    result.onCardDragEnd(true)

    const committed = onCommit.mock.calls[0][0] as DashboardLayoutItem[]
    expect(committed.find((it) => it.i === 'c')).toMatchObject({ y: 6 })
    expect(committed.find((it) => it.i === 'b')).toMatchObject({ y: 11 })
  })

  it('onCardDragEnd with no active drag is a harmless no-op', () => {
    const { result, onCommit } = mountHarness([{ i: 'a', x: 0, y: 0, w: 4, h: 6 }])
    expect(() => result.onCardDragEnd(true)).not.toThrow()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('excludes a pinned card from the reflow pass — dragging another card past it never displaces the pin', async () => {
    const items: DashboardLayoutItem[] = [
      { i: 'pinned', x: 0, y: 0, w: 4, h: 6 },
      { i: 'a', x: 4, y: 0, w: 4, h: 6 },
    ]
    const { result } = mountHarness(items, { pinnedIds: ['pinned'] })
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardDragStart('a', 0, 0)
    result.onCardDragMove(-colStep(), 0)
    flushRaf()

    const preview = result.previewLayout.value
    // 'pinned' never moves regardless of what the drag's candidate position
    // would otherwise collide with.
    expect(preview.find((it) => it.i === 'pinned')).toEqual(items[0])
  })

  it('mobile (cols=1): dragging only ever changes y, never x, and still reorders correctly', async () => {
    // Same 3-item stack/reorder shape as `threeStackedRows`/`DRAG_C_ABOVE_B_DY`
    // above, just at mobile metrics (cols:1, marginX:0, w:1 — mobileLayout's
    // own shape, see dashboardLayout.ts) — proves the SAME reorder math holds
    // regardless of breakpoint, since only the y axis (rowHeight/marginY,
    // unchanged between breakpoints) ever does anything meaningful here.
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 1, h: 6 },
      { i: 'b', x: 0, y: 6, w: 1, h: 8 },
      { i: 'c', x: 0, y: 14, w: 1, h: 5 },
    ]
    const { result } = mountHarness(items, { cols: 1, marginX: 0 })
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardDragStart('c', 0, 100)
    // Large horizontal jitter alongside the vertical move must never affect x.
    result.onCardDragMove(500, 100 + DRAG_C_ABOVE_B_DY)
    flushRaf()

    const preview = result.previewLayout.value
    expect(preview.every((it) => it.x === 0)).toBe(true)
    expect(preview.find((it) => it.i === 'a')).toMatchObject({ y: 0 })
    expect(preview.find((it) => it.i === 'c')).toMatchObject({ y: 6 })
    expect(preview.find((it) => it.i === 'b')).toMatchObject({ y: 11 })
  })

  it('cleans up the pending rAF frame on unmount (no stray callback survives)', async () => {
    const { wrapper, result } = mountHarness([{ i: 'a', x: 0, y: 0, w: 4, h: 6 }])
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardDragStart('a', 0, 0)
    result.onCardDragMove(colStep(), 0)
    expect(rafCallback).not.toBeNull()

    wrapper.unmount()
    // Nothing throws when the (now-orphaned) frame callback would otherwise fire.
    expect(() => flushRaf()).not.toThrow()
  })
})
