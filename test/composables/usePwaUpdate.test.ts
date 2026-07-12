// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { usePwaUpdate } from '@/composables/usePwaUpdate'

// `virtual:pwa-register/vue` is a Vite virtual module vite-plugin-pwa injects
// at build/dev time; it doesn't exist as a real file for Vitest to resolve,
// so it's mocked here with a controllable fake `useRegisterSW` — same
// technique the plugin's own docs recommend for consumer unit tests. The
// fakes must be REAL Vue refs (not plain `{ value }` objects) since
// usePwaUpdate.ts does `watch(offlineReady, ...)`, which requires an actual
// reactive source to track changes.
const needRefresh = ref(false)
const offlineReady = ref(false)
const updateServiceWorker = vi.fn().mockResolvedValue(undefined)
let lastOptions: Record<string, unknown> | undefined

vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: (options?: Record<string, unknown>) => {
    lastOptions = options
    return { needRefresh, offlineReady, updateServiceWorker }
  },
}))

/** Mounts the composable inside a throwaway host component (composables need a component context). */
function mountComposable() {
  let result!: ReturnType<typeof usePwaUpdate>
  const Host = defineComponent({
    setup() {
      result = usePwaUpdate()
      return () => null
    },
  })
  const wrapper = mount(Host)
  return { wrapper, get toast() { return result.toast.value }, reload: () => result.reload(), dismiss: () => result.dismiss() }
}

describe('usePwaUpdate', () => {
  beforeEach(() => {
    needRefresh.value = false
    offlineReady.value = false
    updateServiceWorker.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows no toast until the service worker reports a signal', () => {
    const { toast } = mountComposable()
    expect(toast).toBeNull()
  })

  it('reload() calls updateServiceWorker(true) — the plugin contract that handles skipWaiting + reload', () => {
    needRefresh.value = true
    const { reload } = mountComposable()
    reload()
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('dismiss() hides the update toast without touching a still-pending offline-ready one', () => {
    needRefresh.value = true
    offlineReady.value = true
    const c = mountComposable()
    expect(c.toast).toBe('update')
    c.dismiss()
    expect(c.toast).toBe('offline-ready')
  })

  it('auto-dismisses the offline-ready toast after its timeout, but not a moment before', () => {
    offlineReady.value = true
    const c = mountComposable()
    expect(c.toast).toBe('offline-ready')
    vi.advanceTimersByTime(5999)
    expect(c.toast).toBe('offline-ready')
    vi.advanceTimersByTime(2)
    expect(c.toast).toBeNull()
  })

  it('passes an onRegisterError handler so a failed SW registration cannot throw uncaught', () => {
    mountComposable()
    expect(typeof lastOptions?.onRegisterError).toBe('function')
    expect(() => (lastOptions?.onRegisterError as (e: unknown) => void)(new Error('boom'))).not.toThrow()
  })
})
