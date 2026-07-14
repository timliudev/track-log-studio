// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, ref, watch } from 'vue'
import { mount } from '@vue/test-utils'
import { useDashboardLayout } from '@/composables/useDashboardLayout'
import { GRID_MARGIN, mergeLayoutPositions } from '@/domain/layout/dashboardLayout'

/** Node's default test environment has no real localStorage; this file opts
 *  into happy-dom (for `window`) but still needs the same in-memory stub
 *  other persistence tests use (see dashboardLayout.test.ts). */
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

/** Mounts a throwaway host component so useDashboardLayout's onMounted/
 *  onBeforeUnmount (the resize listener) run inside a real component
 *  instance, and returns the composable's return value. */
function mountHarness(chartIds: number[] = [1]) {
  let result!: ReturnType<typeof useDashboardLayout>
  const Harness = defineComponent({
    setup() {
      const ids = computed(() => chartIds)
      result = useDashboardLayout(ids)
      return () => h('div')
    },
  })
  const wrapper = mount(Harness)
  return { wrapper, layout: result }
}

describe('useDashboardLayout — isMobile breakpoint (#9 fix)', () => {
  it('treats EXACTLY 768px width as mobile — matches every `@media (max-width: 768px)` rule elsewhere in the app', () => {
    window.innerWidth = 768
    const { layout } = mountHarness()
    expect(layout.isMobile.value).toBe(true)
    expect(layout.colNum.value).toBe(1)
  })

  it('treats 769px width as desktop', () => {
    window.innerWidth = 769
    const { layout } = mountHarness()
    expect(layout.isMobile.value).toBe(false)
  })

  it('treats a narrow phone width (375px) as mobile', () => {
    window.innerWidth = 375
    const { layout } = mountHarness()
    expect(layout.isMobile.value).toBe(true)
  })

  it('treats a wide desktop width (1280px) as desktop', () => {
    window.innerWidth = 1280
    const { layout } = mountHarness()
    expect(layout.isMobile.value).toBe(false)
    expect(layout.colNum.value).toBe(12)
  })
})

/**
 * B36 — 手機單欄模式卡片滿版: grid-layout-plus bakes `margin[0]` in as BOTH the
 * inter-item gutter AND the whole grid's own left/right edge inset (see
 * `gridMargin`'s own doc in useDashboardLayout.ts) — on mobile's single
 * column that inset is pure dead space eating into an already-narrow
 * screen, so it's zeroed there while the desktop 2-D grid (which genuinely
 * needs a gutter between side-by-side cards) keeps the full constant
 * unchanged. `margin[1]` (the VERTICAL gap between stacked cards) is never
 * touched at either breakpoint.
 */
describe('useDashboardLayout — gridMargin (B36 mobile full-bleed)', () => {
  it('zeroes only the horizontal margin on mobile, keeping the vertical gap', () => {
    window.innerWidth = 375
    const { layout } = mountHarness()
    expect(layout.gridMargin.value).toEqual([0, GRID_MARGIN[1]])
  })

  it('uses the full GRID_MARGIN constant unchanged on desktop', () => {
    window.innerWidth = 1280
    const { layout } = mountHarness()
    expect(layout.gridMargin.value).toEqual(GRID_MARGIN)
  })
})

/**
 * #4 crash fix — "load two files -> Maximum recursive updates exceeded in
 * <AnalyzerView>" reproduction at the REACTIVITY level (not just the pure
 * mergeLayoutPositions/reconcileLayout unit tests in dashboardLayout.test.ts).
 *
 * Real grid-layout-plus + AnalyzerView are heavy to mount here, so this
 * simulates the exact shape of the wiring that caused the loop:
 *  - `decorated` stands in for AnalyzerView's `activeLayout` GETTER
 *    (decorateForGrid): it derives a BRAND NEW array/objects from
 *    `composable.layout` on every read, same as the real one.
 *  - the `watch(decorated, ...)` stands in for grid-layout-plus's own
 *    internal watcher on its `layout` PROP: a prop is just a computed the
 *    child re-evaluates whenever its source changes BY REFERENCE, and the
 *    library's compaction pass can re-emit `layout-updated` off that (not
 *    only off a real user drag) — exactly like AnalyzerView's
 *    `onLayoutUpdated` handler, the watcher's own callback writes back via
 *    `mergeLayoutPositions`.
 *  - reassigning `chartIdsRef.value` to a new-but-equal-content array
 *    simulates whatever caused `useDashboardLayout`'s `chartIds` watcher to
 *    fire and re-run `reconcileLayout` when the SECOND file was loaded (the
 *    reported trigger — see reconcileLayout's doc for why that watcher can
 *    fire even when nothing chart-related actually changed).
 *
 * Before the #4 fix, `reconcileLayout`/`mergeLayoutPositions` always
 * returned a freshly-allocated (if structurally-equal) array, so EVERY
 * write-back looked like "a change" to Vue's `ref` (which only skips
 * notifying on `Object.is`-equal reassignment) — each echo produced another
 * echo, unbounded. With the fix, once coordinates converge, the write-back
 * hands back the SAME array reference, the `ref` assignment becomes a true
 * no-op, and the chain terminates.
 */
describe('useDashboardLayout — layout/layout-updated feedback loop (#4 crash fix)', () => {
  it('does not runaway-echo when chartIds is reassigned to an equal-content array (load-second-file repro)', async () => {
    window.innerWidth = 1280
    const chartIdsRef = ref<number[]>([1])
    let composable!: ReturnType<typeof useDashboardLayout>
    let echoCount = 0
    const MAX_ECHOES = 5 // safety valve: a regression should fail fast, not hang the test runner

    const Harness = defineComponent({
      setup() {
        const ids = computed(() => chartIdsRef.value)
        composable = useDashboardLayout(ids)

        const decorated = computed(() =>
          composable.layout.value.map((it) => ({ ...it, isDraggable: true, isResizable: true })),
        )

        watch(
          decorated,
          (next) => {
            echoCount++
            if (echoCount > MAX_ECHOES) return
            composable.layout.value = mergeLayoutPositions(composable.layout.value, next)
          },
          { flush: 'sync' },
        )

        return () => h('div')
      },
    })
    mount(Harness)

    echoCount = 0 // ignore whatever the initial mount settled at
    chartIdsRef.value = [1] // new array, SAME ids — the reported trigger
    await nextTick()

    expect(echoCount).toBeLessThan(MAX_ECHOES)
  })
})
