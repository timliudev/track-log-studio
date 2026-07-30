// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useCssGridDashboardResize } from '@/composables/useCssGridDashboardResize'
import type { DashboardLayoutItem } from '@/domain/layout/dashboardLayout'

// Same 12-col / 24 row-height / 12px margin metrics gridGutter.test.ts,
// cssGridDrag.test.ts and useCssGridDashboardDrag.test.ts already use.
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
 *  by useGridGutters.test.ts/useCssGridDashboardDrag.test.ts. */
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

function flushRaf(): void {
  const cb = rafCallback
  rafCallback = null
  cb?.(0)
}

function mountHarness(
  initialLayout: DashboardLayoutItem[],
  opts: {
    pinnedIds?: string[]
    collapsedIds?: ReadonlySet<string>
    cols?: number
    resizable?: boolean
    isMobile?: boolean
    marginX?: number
  } = {},
) {
  let result!: ReturnType<typeof useCssGridDashboardResize>
  const layoutRef = ref(initialLayout)
  const pinnedIdsRef = ref(opts.pinnedIds ?? [])
  const collapsedIdsRef = ref<ReadonlySet<string>>(opts.collapsedIds ?? new Set())
  const colsRef = ref(opts.cols ?? COLS)
  const resizableRef = ref(opts.resizable ?? true)
  const isMobileRef = ref(opts.isMobile ?? false)
  const marginXRef = ref(opts.marginX ?? MARGIN_X)
  const onCommit = vi.fn()
  const Harness = defineComponent({
    setup() {
      result = useCssGridDashboardResize({
        layout: computed(() => layoutRef.value),
        pinnedIds: computed(() => pinnedIdsRef.value),
        collapsedIds: computed(() => collapsedIdsRef.value),
        cols: computed(() => colsRef.value),
        rowHeight: ROW_HEIGHT,
        marginX: computed(() => marginXRef.value),
        marginY: MARGIN_Y,
        resizable: computed(() => resizableRef.value),
        isMobile: computed(() => isMobileRef.value),
        onCommit,
      })
      return () => h('div')
    },
  })
  const wrapper = mount(Harness)
  return { wrapper, result, layoutRef, pinnedIdsRef, collapsedIdsRef, colsRef, resizableRef, isMobileRef, onCommit }
}

describe('useCssGridDashboardResize', () => {
  it('previewLayout equals the input layout when nothing is being resized', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ]
    const { result } = mountHarness(items)
    expect(result.previewLayout.value).toEqual(items)
    expect(result.resizingId.value).toBeNull()
  })

  it('isItemResizableNow is true for an ordinary card when the grid-wide toggle is on', () => {
    const { result } = mountHarness([{ i: 'a', x: 0, y: 0, w: 4, h: 6 }])
    expect(result.isItemResizableNow('a')).toBe(true)
  })

  it('isItemResizableNow is false when the grid-wide toggle is off (鎖定布局)', () => {
    const { result } = mountHarness([{ i: 'a', x: 0, y: 0, w: 4, h: 6 }], { resizable: false })
    expect(result.isItemResizableNow('a')).toBe(false)
  })

  it('isItemResizableNow is false for a pinned card even when the grid-wide toggle is on', () => {
    const { result } = mountHarness([{ i: 'a', x: 0, y: 0, w: 4, h: 6 }], { pinnedIds: ['a'] })
    expect(result.isItemResizableNow('a')).toBe(false)
  })

  it('isItemResizableNow is false for a collapsed card', () => {
    const { result } = mountHarness([{ i: 'a', x: 0, y: 0, w: 4, h: 6 }], { collapsedIds: new Set(['a']) })
    expect(result.isItemResizableNow('a')).toBe(false)
  })

  it('onCardResizeStart is a no-op for a non-resizable (pinned) card — no preview change, no resizingId', async () => {
    const items: DashboardLayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 4, h: 6 }]
    const { result } = mountHarness(items, { pinnedIds: ['a'] })
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardResizeStart('a', 100, 100)
    expect(result.resizingId.value).toBeNull()
    expect(result.previewLayout.value).toEqual(items)
  })

  it('onCardResizeStart is a no-op while the grid-wide toggle is off', async () => {
    const items: DashboardLayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 4, h: 6 }]
    const { result } = mountHarness(items, { resizable: false })
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardResizeStart('a', 100, 100)
    expect(result.resizingId.value).toBeNull()
  })

  it('starting a resize sets resizingId, and a zero move leaves previewLayout unchanged', async () => {
    const items: DashboardLayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 4, h: 6 }]
    const { result } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardResizeStart('a', 100, 100)
    expect(result.resizingId.value).toBe('a')
    expect(result.previewLayout.value).toEqual(items)
  })

  it('growing the corner past a whole cell updates ONLY the resized item — siblings are left untouched (no live reflow)', async () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ]
    const { result } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardResizeStart('a', 0, 0)
    result.onCardResizeMove(colStep(), rowStep())
    // Not yet applied — coalesced until the rAF frame fires.
    expect(result.previewLayout.value.find((it) => it.i === 'a')).toMatchObject({ w: 4, h: 6 })

    flushRaf()
    const preview = result.previewLayout.value
    expect(preview.find((it) => it.i === 'a')).toMatchObject({ w: 5, h: 7 })
    // 'b' is completely untouched, even though it now visually overlaps —
    // reflow only happens once the gesture commits through writeBackLayout.
    expect(preview.find((it) => it.i === 'b')).toEqual(items[1])
  })

  it('shrinking clamps at the card\'s own minimum size (chart minW:3/minH:5)', async () => {
    const items: DashboardLayoutItem[] = [{ i: 'chart-1', x: 0, y: 0, w: 4, h: 6 }]
    const { result } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardResizeStart('chart-1', 0, 0)
    result.onCardResizeMove(-colStep() * 10, -rowStep() * 10)
    flushRaf()

    expect(result.previewLayout.value.find((it) => it.i === 'chart-1')).toMatchObject({ w: 3, h: 5 })
  })

  it('coalesces several moves within one frame into a single update (only the LATEST size matters)', async () => {
    const items: DashboardLayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 4, h: 6 }]
    const { result } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardResizeStart('a', 0, 0)

    result.onCardResizeMove(colStep(), 0)
    result.onCardResizeMove(colStep() * 3, 0)
    result.onCardResizeMove(colStep() * 2, 0)
    flushRaf()

    expect(result.previewLayout.value.find((it) => it.i === 'a')).toMatchObject({ w: 6 })
    expect(rafCallback).toBeNull()
  })

  it('committing (pointerup) calls onCommit with the settled preview and clears resize state', async () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ]
    const { result, onCommit } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardResizeStart('a', 0, 0)
    result.onCardResizeMove(colStep() * 2, 0)
    flushRaf()

    result.onCardResizeEnd(true)

    expect(onCommit).toHaveBeenCalledTimes(1)
    const committed = onCommit.mock.calls[0][0] as DashboardLayoutItem[]
    expect(committed.find((it) => it.i === 'a')).toMatchObject({ w: 6 })
    expect(committed.find((it) => it.i === 'b')).toEqual(items[1])
    expect(result.resizingId.value).toBeNull()
    expect(result.previewLayout.value).toEqual(items)
  })

  it('aborting (committed: false) does NOT call onCommit and discards the preview', async () => {
    const items: DashboardLayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 4, h: 6 }]
    const { result, onCommit } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardResizeStart('a', 0, 0)
    result.onCardResizeMove(colStep() * 2, 0)
    flushRaf()

    result.onCardResizeEnd(false)

    expect(onCommit).not.toHaveBeenCalled()
    expect(result.resizingId.value).toBeNull()
    expect(result.previewLayout.value).toEqual(items)
  })

  it('flushes a pending (not-yet-rAF-fired) move before committing, so the very latest size is never lost', async () => {
    const items: DashboardLayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 4, h: 6 }]
    const { result, onCommit } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardResizeStart('a', 0, 0)
    result.onCardResizeMove(colStep() * 2, 0)
    // No flushRaf() here — the gesture ends before the browser ever painted a frame.
    result.onCardResizeEnd(true)

    const committed = onCommit.mock.calls[0][0] as DashboardLayoutItem[]
    expect(committed.find((it) => it.i === 'a')).toMatchObject({ w: 6 })
  })

  it('onCardResizeEnd with no active resize is a harmless no-op', () => {
    const { result, onCommit } = mountHarness([{ i: 'a', x: 0, y: 0, w: 4, h: 6 }])
    expect(() => result.onCardResizeEnd(true)).not.toThrow()
    expect(onCommit).not.toHaveBeenCalled()
  })

  describe('B59 — mobile vertical-only resize', () => {
    // 'currentvalues' (STATIC_CARD_IDS.currentValues) has minW:1 — matches a
    // mobile single-column slot exactly, unlike a generic id (DEFAULT_MIN_SIZE
    // minW:2), which would get clamped UP past cols:1 regardless of this
    // test's own horizontal-delta guard and muddy what's being asserted.
    it('a large horizontal jitter never changes w on mobile, only h', async () => {
      const items: DashboardLayoutItem[] = [{ i: 'currentvalues', x: 0, y: 0, w: 1, h: 6 }]
      const { result } = mountHarness(items, { cols: 1, marginX: 0, isMobile: true })
      result.containerRef.value = document.createElement('div')
      await nextTick()
      result.onCardResizeStart('currentvalues', 0, 0)
      result.onCardResizeMove(500, rowStep() * 2)
      flushRaf()

      expect(result.previewLayout.value.find((it) => it.i === 'currentvalues')).toMatchObject({ w: 1, h: 8 })
    })
  })

  it('cleans up the pending rAF frame on unmount (no stray callback survives)', async () => {
    const { wrapper, result } = mountHarness([{ i: 'a', x: 0, y: 0, w: 4, h: 6 }])
    result.containerRef.value = document.createElement('div')
    await nextTick()
    result.onCardResizeStart('a', 0, 0)
    result.onCardResizeMove(colStep(), 0)
    expect(rafCallback).not.toBeNull()

    wrapper.unmount()
    expect(() => flushRaf()).not.toThrow()
  })
})
