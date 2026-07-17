// @vitest-environment happy-dom
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import GearPanel from '@/features/analyzer/GearPanel.vue'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { vTooltip } from '@/directives/tooltip'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * #4 (codex-verify-triage report) — a user on a CVT bike sets drivetrain kind
 * to 'cvt' (matching their real vehicle) and from then on the ENTIRE "由記錄
 * 反推周長" section — button, disabled-reason hint, result — disappears from
 * the DOM (the MT branch's `estimateDisabledReason`/`runCircumferenceEstimate`
 * live inside `<template v-if="isMt">`; the CVT `v-else` branch never had an
 * equivalent). A CVT user would reasonably conclude the feature "isn't
 * implemented" since they never see any trace of it. Real-log verification
 * (LogaExample's 5 .loga files, all CVT scooters) confirms the underlying
 * estimator correctly returns NaN for these logs — CVT has no discrete gear
 * plateaus to solve for, so this is NOT a bug to fix in the math. The fix is
 * a permanently-disabled button + explanatory hint in the CVT branch, mirror
 * of the MT branch's disabled-with-reason pattern, so the limitation is
 * visible instead of silently absent.
 */

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

/** happy-dom's canvas 2D context stub is incomplete — GearPanel's CVT branch
 *  also renders UPlotChart charts as soon as data exists, so stub `getContext`
 *  the same way GearPanel.regression.test.ts does. Scoped to this file only. */
function installFakeCanvasContext(): void {
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

function mountPanel(session: LogSession | null) {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  return mount(GearPanel, {
    props: { session },
    global: { plugins: [i18n], directives: { tooltip: vTooltip } },
  })
}

describe('GearPanel — CVT mode shows a disabled estimate button + explanation (#4)', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    localStorage.clear()
    installFakeCanvasContext()
    setActivePinia(createPinia())
  })

  it('renders a permanently-disabled "由記錄反推" button with an explanatory hint in CVT mode', () => {
    const store = useDrivetrainStore()
    store.setKind('cvt')
    const session = new LogSession(
      [channel('RPM', [6000, 6100, 6200]), channel('GPS_Speed', [30, 31, 32])],
      { formatId: 'nmea', createdDate: null, headerInfo: {} },
    )
    const wrapper = mountPanel(session)

    const btn = wrapper.find('.apply-btn')
    expect(btn.exists()).toBe(true)
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.text()).toContain('CVT 為連續變速，沒有可用來反推的離散檔位')
    expect(wrapper.text()).toContain('請直接量測後輪周長')
  })

  it('does not render the CVT-only hint text in MT mode (default)', () => {
    const wrapper = mountPanel(null)
    expect(wrapper.text()).not.toContain('沒有離散檔位可判定')
  })
})
