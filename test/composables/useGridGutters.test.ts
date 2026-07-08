// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useGridGutters } from '@/composables/useGridGutters'
import { STATIC_CARD_IDS, chartItemId, type DashboardLayoutItem } from '@/domain/layout/dashboardLayout'

/** Same 12-col / 24 row-height / 12px margin metrics gridGutter.test.ts uses,
 *  so the expected pixel math here is easy to cross-check against that file. */
const COLS = 12
const ROW_HEIGHT = 24
const MARGIN_X = 12
const MARGIN_Y = 12

/** happy-dom's ResizeObserver never actually fires from real layout (there's
 *  no layout engine computing box sizes), so — same technique used elsewhere
 *  in this repo (test/units/uplotChartGuard.test.ts) — tests install a fake
 *  that reports a controlled width synchronously from `observe()`. */
let mockWidth = 1224
class FakeResizeObserver {
  private readonly cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(): void {
    this.cb([{ contentRect: { width: mockWidth } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  mockWidth = 1224
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

/** A minimal fake pointer-event target: records listeners registered via
 *  addEventListener so a test can invoke them directly (as if the browser
 *  had dispatched a real pointermove/pointerup), without depending on
 *  happy-dom's PointerEvent constructor support. */
function fakeTarget() {
  const listeners: Record<string, (e: unknown) => void> = {}
  return {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    addEventListener: vi.fn((type: string, cb: (e: unknown) => void) => {
      listeners[type] = cb
    }),
    removeEventListener: vi.fn((type: string) => {
      delete listeners[type]
    }),
    listeners,
  }
}

function mountHarness(initialItems: DashboardLayoutItem[], initialEnabled = true) {
  let result!: ReturnType<typeof useGridGutters>
  const itemsRef = ref(initialItems)
  const enabledRef = ref(initialEnabled)
  const onChange = vi.fn()
  const Harness = defineComponent({
    setup() {
      result = useGridGutters({
        items: computed(() => itemsRef.value),
        enabled: computed(() => enabledRef.value),
        cols: COLS,
        rowHeight: ROW_HEIGHT,
        marginX: MARGIN_X,
        marginY: MARGIN_Y,
        onChange,
      })
      return () => h('div')
    },
  })
  const wrapper = mount(Harness)
  return { wrapper, result, itemsRef, enabledRef, onChange }
}

/** Column/row step in px — the pixel distance that maps to exactly 1 grid-unit
 *  delta (mirrors gridGutter.test.ts's own `colStep`/`rowStep`). */
function colStepFor(width: number): number {
  const colWidth = (width - MARGIN_X * (COLS + 1)) / COLS
  return colWidth + MARGIN_X
}
function rowStep(): number {
  return ROW_HEIGHT + MARGIN_Y
}

describe('useGridGutters — gutters computed', () => {
  it('is empty before the container is measured', () => {
    const { result } = mountHarness([
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ])
    expect(result.gutters.value).toEqual([])
  })

  it('detects a vertical gutter and computes its pixel rect once the container is measured', async () => {
    const { result } = mountHarness([
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ])
    result.containerRef.value = document.createElement('div')
    await nextTick()

    expect(result.gutters.value).toHaveLength(1)
    const g = result.gutters.value[0]
    expect(g.orientation).toBe('vertical')
    expect(g.aId).toBe('a')
    expect(g.bId).toBe('b')
    expect(g.key).toBe('vertical:a:b')
    // Sanity: the rect sits between the two 4-col-wide cards, one margin wide.
    expect(g.rect.width).toBeCloseTo(MARGIN_X)
  })

  it('is empty when disabled, even with adjacent cards and a measured container', async () => {
    const { result, enabledRef } = mountHarness(
      [
        { i: 'a', x: 0, y: 0, w: 4, h: 6 },
        { i: 'b', x: 4, y: 0, w: 4, h: 6 },
      ],
      false,
    )
    result.containerRef.value = document.createElement('div')
    await nextTick()
    expect(result.gutters.value).toEqual([])

    enabledRef.value = true
    await nextTick()
    expect(result.gutters.value).toHaveLength(1)
  })

  it('re-derives gutters when the items array changes (e.g. a card is pinned and excluded upstream)', async () => {
    const { result, itemsRef } = mountHarness([
      { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 4, h: 6 },
      { i: chartItemId(1), x: 4, y: 0, w: 4, h: 6 },
    ])
    result.containerRef.value = document.createElement('div')
    await nextTick()
    expect(result.gutters.value).toHaveLength(1)

    // Caller excludes the pinned card upstream (AnalyzerView filters isPinned
    // out before passing `items` in) — simulate that by dropping it here.
    itemsRef.value = [{ i: chartItemId(1), x: 4, y: 0, w: 4, h: 6 }]
    await nextTick()
    expect(result.gutters.value).toEqual([])
  })
})

describe('useGridGutters — onGutterPointerDown drag', () => {
  it('does nothing when disabled', () => {
    const { result } = mountHarness(
      [
        { i: 'a', x: 0, y: 0, w: 4, h: 6 },
        { i: 'b', x: 4, y: 0, w: 4, h: 6 },
      ],
      false,
    )
    const target = fakeTarget()
    result.onGutterPointerDown(
      { orientation: 'vertical', aId: 'a', bId: 'b', edge: 4, start: 0, end: 6 },
      { preventDefault: vi.fn(), currentTarget: target, pointerId: 1, clientX: 0, clientY: 0 } as unknown as PointerEvent,
    )
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    expect(target.addEventListener).not.toHaveBeenCalled()
  })

  it('drags a vertical gutter: growing a.w / shrinking+shifting b, via a single onChange call per move', async () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ]
    const { result, onChange } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    const gutter = result.gutters.value[0]
    expect(gutter).toBeDefined()

    const target = fakeTarget()
    const preventDefault = vi.fn()
    result.onGutterPointerDown(gutter, {
      preventDefault,
      currentTarget: target,
      pointerId: 5,
      clientX: 0,
      clientY: 0,
    } as unknown as PointerEvent)

    expect(preventDefault).toHaveBeenCalled()
    expect(target.setPointerCapture).toHaveBeenCalledWith(5)
    expect(result.draggingKey.value).toBe('vertical:a:b')

    const step = colStepFor(mockWidth)
    target.listeners['pointermove']({ clientX: step, clientY: 0, pointerId: 5 })

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as DashboardLayoutItem[]
    expect(next.find((it) => it.i === 'a')).toMatchObject({ w: 5 })
    expect(next.find((it) => it.i === 'b')).toMatchObject({ x: 5, w: 3 })

    target.listeners['pointerup']({ pointerId: 5 })
    expect(target.releasePointerCapture).toHaveBeenCalledWith(5)
    expect(target.removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(result.draggingKey.value).toBeNull()
  })

  it('drags a horizontal gutter symmetrically (top/bottom)', async () => {
    const items: DashboardLayoutItem[] = [
      { i: 'top', x: 0, y: 0, w: 4, h: 6 },
      { i: 'bottom', x: 0, y: 6, w: 4, h: 6 },
    ]
    const { result, onChange } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    const gutter = result.gutters.value[0]

    const target = fakeTarget()
    result.onGutterPointerDown(gutter, {
      preventDefault: vi.fn(),
      currentTarget: target,
      pointerId: 2,
      clientX: 0,
      clientY: 0,
    } as unknown as PointerEvent)

    target.listeners['pointermove']({ clientX: 0, clientY: -rowStep() * 2, pointerId: 2 })

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as DashboardLayoutItem[]
    expect(next.find((it) => it.i === 'top')).toMatchObject({ h: 4 })
    expect(next.find((it) => it.i === 'bottom')).toMatchObject({ y: 4, h: 8 })
  })

  it('does not call onChange for a sub-threshold move (rounds to 0 grid units)', async () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ]
    const { result, onChange } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    const gutter = result.gutters.value[0]

    const target = fakeTarget()
    result.onGutterPointerDown(gutter, {
      preventDefault: vi.fn(),
      currentTarget: target,
      pointerId: 3,
      clientX: 0,
      clientY: 0,
    } as unknown as PointerEvent)

    target.listeners['pointermove']({ clientX: 1, clientY: 0, pointerId: 3 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clamps the drag at the min-size floor (same as applyGutterDrag/clampGutterDeltaUnits)', async () => {
    // map minW 3, gear minW 3 — same fixtures as gridGutter.test.ts.
    const items: DashboardLayoutItem[] = [
      { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 5, h: 10 },
      { i: STATIC_CARD_IDS.gear, x: 5, y: 0, w: 5, h: 10 },
    ]
    const { result, onChange } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    const gutter = result.gutters.value[0]

    const target = fakeTarget()
    result.onGutterPointerDown(gutter, {
      preventDefault: vi.fn(),
      currentTarget: target,
      pointerId: 4,
      clientX: 0,
      clientY: 0,
    } as unknown as PointerEvent)

    // Drag far past what either card's min size allows.
    const step = colStepFor(mockWidth)
    target.listeners['pointermove']({ clientX: step * 10, clientY: 0, pointerId: 4 })

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as DashboardLayoutItem[]
    // b (gear) can only shrink to its minW (3): 5 -> 3, so a grows by 2 -> 7.
    expect(next.find((it) => it.i === STATIC_CARD_IDS.gear)).toMatchObject({ w: 3 })
    expect(next.find((it) => it.i === STATIC_CARD_IDS.map)).toMatchObject({ w: 7 })
  })
})
