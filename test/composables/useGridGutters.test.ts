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

/** `onMove` is registered on `window` (see #6 fix in useGridGutters.ts's doc
 *  — a target-scoped listener would go silent as soon as the gutter's own
 *  DOM node gets swapped out mid-drag, which is exactly what happens after
 *  the very first grid-unit step), so tests simulate a real pointermove by
 *  dispatching a plain `Event` on `window` with the fields `onMove` reads
 *  stamped on via `defineProperty` — same technique the pre-existing
 *  window-level pointerup test below already uses (happy-dom's `PointerEvent`
 *  constructor isn't reliable enough to build one directly). */
function dispatchWindowPointerMove(clientX: number, clientY: number, pointerId: number): void {
  const evt = new Event('pointermove') as unknown as PointerEvent
  Object.defineProperty(evt, 'clientX', { value: clientX })
  Object.defineProperty(evt, 'clientY', { value: clientY })
  Object.defineProperty(evt, 'pointerId', { value: pointerId })
  window.dispatchEvent(evt)
}

/** Ends a drag from the window side (same as the real browser delivering the
 *  up-event there) — used to tidy up tests that don't otherwise finish their
 *  drag, so they don't leave a `window`-level `pointermove` listener for that
 *  `pointerId` registered past the end of the test. */
function dispatchWindowPointerUp(pointerId: number): void {
  const evt = new Event('pointerup') as unknown as PointerEvent
  Object.defineProperty(evt, 'pointerId', { value: pointerId })
  window.dispatchEvent(evt)
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

  it('drags a vertical gutter: grows a.w only, via a single onChange call per move; b (#5) is left untouched here', async () => {
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
    dispatchWindowPointerMove(step, 0, 5)

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as DashboardLayoutItem[]
    expect(next.find((it) => it.i === 'a')).toMatchObject({ w: 5 })
    // b is byte-for-byte unchanged — reflow (pushing b out of the way, if
    // needed) is left to grid-layout-plus's own compaction once this flows
    // back through AnalyzerView's `layout` prop, not this composable.
    expect(next.find((it) => it.i === 'b')).toEqual(items[1])

    target.listeners['pointerup']({ pointerId: 5 })
    expect(target.releasePointerCapture).toHaveBeenCalledWith(5)
    expect(target.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function))
    expect(result.draggingKey.value).toBeNull()
  })

  it('drags a horizontal gutter: grows/shrinks ONLY the top card (a), bottom (b) untouched', async () => {
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

    // Dragging the gutter DOWN (positive clientY delta) grows the card ABOVE
    // it (top) — the #5 "resize the side you grabbed" model.
    dispatchWindowPointerMove(0, rowStep() * 2, 2)

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as DashboardLayoutItem[]
    expect(next.find((it) => it.i === 'top')).toMatchObject({ h: 8 })
    expect(next.find((it) => it.i === 'bottom')).toEqual(items[1])

    dispatchWindowPointerUp(2)
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

    dispatchWindowPointerMove(1, 0, 3)
    expect(onChange).not.toHaveBeenCalled()

    dispatchWindowPointerUp(3)
  })

  it('clamps a shrink-drag at a\'s OWN min-size floor (#5 — b\'s floor no longer applies, it never shrinks here)', async () => {
    // map minW 3 — same fixture as gridGutter.test.ts.
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

    // Drag far past what a's own min size allows.
    const step = colStepFor(mockWidth)
    dispatchWindowPointerMove(-step * 10, 0, 4)

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as DashboardLayoutItem[]
    // map (a) can only shrink to its own minW (3): 5 -> 3.
    expect(next.find((it) => it.i === STATIC_CARD_IDS.map)).toMatchObject({ w: 3 })
    // gear (b) is completely untouched — it no longer grows to compensate.
    expect(next.find((it) => it.i === STATIC_CARD_IDS.gear)).toEqual(items[1])

    dispatchWindowPointerUp(4)
  })

  it('caps a vertical gutter\'s growth at the grid column count (cols=12, passed through from AnalyzerView\'s metrics)', async () => {
    const items: DashboardLayoutItem[] = [
      { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 5, h: 10 },
      { i: STATIC_CARD_IDS.gear, x: 5, y: 0, w: 7, h: 10 },
    ]
    const { result, onChange } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    const gutter = result.gutters.value[0]

    const target = fakeTarget()
    result.onGutterPointerDown(gutter, {
      preventDefault: vi.fn(),
      currentTarget: target,
      pointerId: 6,
      clientX: 0,
      clientY: 0,
    } as unknown as PointerEvent)

    // Drag far past the grid's own 12-column width.
    const step = colStepFor(mockWidth)
    dispatchWindowPointerMove(step * 20, 0, 6)

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as DashboardLayoutItem[]
    // map (a) grows to fill exactly to column 12 (x:0 + w:12 = 12), no further.
    expect(next.find((it) => it.i === STATIC_CARD_IDS.map)).toMatchObject({ w: 12 })
    expect(next.find((it) => it.i === STATIC_CARD_IDS.gear)).toEqual(items[1])

    dispatchWindowPointerUp(6)
  })

  // #6 fix — "gutter drag only moves one grid step, then sticks until
  // pointer-up + a fresh pointer-down". Root cause: `onMove` used to be
  // registered on `target` (the gutter `<div>` the drag started on) ONLY —
  // but AnalyzerView's real `onChange` resizes `a` and moves its edge away
  // from `b`, so `detectGutters` stops pairing them and Vue unmounts that
  // SPECIFIC `<div>` on the very next render (same "DOM node swapped out
  // mid-drag" scenario #1's fix already handles for pointerup/pointercancel,
  // just for pointermove instead). A target-only pointermove listener would
  // go silent right there. This drives that exact scenario with a target
  // that can never itself deliver another pointermove (standing in for the
  // unmounted div) and asserts the drag keeps tracking TWO separate window-
  // level moves, each producing its own onChange call with the correct
  // ABSOLUTE (not stuck-at-the-first-step) delta from the original down-point.
  it('keeps tracking pointermove via window through multiple moves even when the original target never receives its own pointermove (continuous drag)', async () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ]
    const { result, onChange } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    const gutter = result.gutters.value[0]

    const deadTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    result.onGutterPointerDown(gutter, {
      preventDefault: vi.fn(),
      currentTarget: deadTarget,
      pointerId: 8,
      clientX: 0,
      clientY: 0,
    } as unknown as PointerEvent)

    const step = colStepFor(mockWidth)
    // First move: +1 grid unit from the down-point.
    dispatchWindowPointerMove(step, 0, 8)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((onChange.mock.calls[0][0] as DashboardLayoutItem[]).find((it) => it.i === 'a')).toMatchObject({ w: 5 })

    // Second move, further along the SAME gesture (no pointer-up in
    // between) — the total offset from the down-point is now +3 grid units,
    // not "stuck" at the first move's +1.
    dispatchWindowPointerMove(step * 3, 0, 8)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect((onChange.mock.calls[1][0] as DashboardLayoutItem[]).find((it) => it.i === 'a')).toMatchObject({ w: 7 })

    dispatchWindowPointerUp(8)
  })

  // #1 fix — "the pink gutter block stays stuck on screen after the drag
  // ends". Root cause: `gutters`' v-for is keyed by `orientation:aId:bId`
  // and re-derives on every `onChange` (a moved edge can change which cards
  // are adjacent), so the SPECIFIC DOM node a drag started on can get
  // swapped out by Vue mid-drag — events aimed at that (now-detached)
  // element, including its own pointerup/pointercancel listeners, never
  // arrive again. A target-only listener would leave `draggingKey` (and the
  // highlight it drives) stuck forever in that case. The fix adds a
  // WINDOW-level pointerup/pointercancel listener that doesn't depend on any
  // particular element still being mounted.
  it('ends the drag (clears draggingKey) via a WINDOW-level pointerup even when the original target never receives its own pointerup', async () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ]
    const { result } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    const gutter = result.gutters.value[0]

    // A target whose addEventListener silently drops the callback — stands
    // in for "the DOM node this drag started on got removed/replaced mid-
    // drag", so it can never itself dispatch pointerup/pointercancel again.
    const deadTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    result.onGutterPointerDown(gutter, {
      preventDefault: vi.fn(),
      currentTarget: deadTarget,
      pointerId: 7,
      clientX: 0,
      clientY: 0,
    } as unknown as PointerEvent)
    expect(result.draggingKey.value).toBe('vertical:a:b')

    // Simulate the browser delivering pointerup to the window instead (the
    // safety-net registration) — e.g. the real target is already gone.
    const evt = new Event('pointerup') as unknown as PointerEvent
    Object.defineProperty(evt, 'pointerId', { value: 7 })
    window.dispatchEvent(evt)

    expect(result.draggingKey.value).toBeNull()
  })

  it('force-ends an in-progress drag when the component unmounts mid-drag', async () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ]
    const { wrapper, result } = mountHarness(items)
    result.containerRef.value = document.createElement('div')
    await nextTick()
    const gutter = result.gutters.value[0]

    const target = fakeTarget()
    result.onGutterPointerDown(gutter, {
      preventDefault: vi.fn(),
      currentTarget: target,
      pointerId: 9,
      clientX: 0,
      clientY: 0,
    } as unknown as PointerEvent)
    expect(result.draggingKey.value).toBe('vertical:a:b')

    wrapper.unmount()

    expect(result.draggingKey.value).toBeNull()
  })
})
