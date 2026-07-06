// @vitest-environment happy-dom
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import GearPanel from '@/features/analyzer/GearPanel.vue'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * Regression test for 4d2f90d — GearPanel is a single long-lived instance in
 * AnalyzerView (no :key on file switch), so estimateResult/estimateFailed
 * (plain refs, not derived from props.session) used to keep showing the
 * PREVIOUS log's back-estimated circumference/sample-count (or its failure
 * hint) after switching to a different recording, misrepresenting a value
 * computed from data that's no longer loaded. The fix adds a
 * `watch(() => props.session, ...)` that clears both refs on session change;
 * this test mounts the panel once, runs an estimate, swaps the `session`
 * prop, and asserts the stale message is gone.
 */

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

/** RPM held constant at 6000 with the speed that DEFAULT_MT's gear-1 total
 *  reduction (primary 2.833 x ratio 2.615 x final-drive 45/15) and default
 *  1870mm circumference imply (~30.29 km/h) — same single-gear-constant
 *  shape as drivetrain.test.ts's hand-computed inversion case, chosen so
 *  `estimateCircumferenceFromLog` finds a stable cluster without needing to
 *  touch any of GearPanel's own default form state. */
function sessionWithSteadyGear1(n = 30): LogSession {
  const rpm = new Array(n).fill(6000)
  const speed = new Array(n).fill(30.29)
  return new LogSession(
    [channel('RPM', rpm), channel('GPS_Speed', speed)],
    { formatId: 'nmea', createdDate: null, headerInfo: {} },
  )
}

function mountPanel(session: LogSession | null) {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  return mount(GearPanel, {
    props: { session },
    global: { plugins: [i18n] },
  })
}

/** happy-dom's canvas 2D context stub is incomplete (missing e.g.
 *  `clearRect`), and GearPanel's chart section (UPlotChart -> uplot) draws
 *  into a real `<canvas>` as soon as it mounts with data — outside the scope
 *  of this regression test (which only cares about the estimate hint text),
 *  so stub `getContext` with just enough no-op methods for uPlot's internal
 *  draw loop to run without throwing. Scoped to this file only. */
function installFakeCanvasContext(): void {
  // Any method uPlot calls on the context (fillText, strokeRect, ...) becomes
  // a no-op; any property read (e.g. `font`) is settable/gettable via a
  // backing plain object. Avoids having to enumerate uPlot's exact internal
  // Canvas2D usage by hand.
  const backing: Record<string, unknown> = {}
  const fakeCtx = new Proxy(backing, {
    get(target, prop) {
      if (prop in target) return target[prop as string]
      if (prop === 'measureText') return () => ({ width: 0 })
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} })
      return () => {}
    },
    set(target, prop, value) {
      target[prop as string] = value
      return true
    },
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => fakeCtx,
    configurable: true,
  })
  // happy-dom has no Path2D global either — uPlot's series-path drawing
  // constructs one directly (not via ctx), so stub a no-op class.
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo() {}
      lineTo() {}
      closePath() {}
      rect() {}
      arc() {}
      bezierCurveTo() {}
    },
  )
}

/** drivetrainStore persists to localStorage; this environment doesn't wire
 *  one up automatically, so stub an in-memory implementation — same approach
 *  test/stores/drivetrainStore.test.ts uses under the `node` environment. */
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

describe('GearPanel — session-switch clears stale estimate (regression 4d2f90d)', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    localStorage.clear()
    installFakeCanvasContext()
    setActivePinia(createPinia())
  })

  it('clears a successful estimate result after switching to a different session', async () => {
    const wrapper = mountPanel(sessionWithSteadyGear1())

    await wrapper.find('.apply-btn').trigger('click')
    expect(wrapper.text()).toContain('mm')
    expect(wrapper.find('.estimate-ok').exists()).toBe(true)

    await wrapper.setProps({ session: sessionWithSteadyGear1(45) })

    expect(wrapper.find('.estimate-ok').exists()).toBe(false)
    expect(wrapper.find('.estimate-err').exists()).toBe(false)
  })

  it('clears a failed-estimate hint after switching sessions', async () => {
    // Too few samples for MIN_ESTIMATE_SAMPLES -> estimateFailed becomes true.
    const tinySession = new LogSession(
      [channel('RPM', [6000, 6001]), channel('GPS_Speed', [30, 30])],
      { formatId: 'nmea', createdDate: null, headerInfo: {} },
    )
    const wrapper = mountPanel(tinySession)

    await wrapper.find('.apply-btn').trigger('click')
    expect(wrapper.find('.estimate-err').exists()).toBe(true)

    await wrapper.setProps({ session: sessionWithSteadyGear1() })

    expect(wrapper.find('.estimate-err').exists()).toBe(false)
  })
})
