// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useDashboardLayout } from '@/composables/useDashboardLayout'

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
