// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type uPlot from 'uplot'
import UPlotChart, { xBandRect } from '@/components/UPlotChart.vue'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * F8 Stage 5 — `xBands` shading on `UPlotChart.vue` (used by `GearPanel.vue`
 * to shade the engine's usable RPM band on the MT chart).
 *
 * The pixel geometry lives in the plain-script-exported `xBandRect` (same
 * "unit-testable without mounting uPlot" convention this file already uses
 * for `valueAtPlotX`/`fillPlotHeight`/`isZoomed` — see their doc comments)
 * specifically because real uPlot geometry needs actual canvas/layout
 * measurement that happy-dom's fake canvas 2D context (see
 * `GearPanel.gearLineRendering.test.ts`'s `installFakeCanvasContext`) can't
 * reliably produce — a mount-level test asserting exact `fillRect` pixel
 * calls against that fake context proved flaky in practice. The mount-level
 * test below only smoke-tests that passing `xBands` doesn't throw.
 */

describe('xBandRect', () => {
  const bbox = { top: 10, height: 200 }

  it('computes a rect from two ascending-pixel edges', () => {
    const rect = xBandRect({ min: 4000, max: 8000 }, (v) => v / 10, bbox)
    expect(rect).toEqual({ x: 400, y: 10, width: 400, height: 200 })
  })

  it('handles a reversed (max < min in pixel space) mapping via min/abs, not input order', () => {
    // A mapper where larger data values map to SMALLER pixels (e.g. an
    // inverted scale) — the rect must still describe the correct span.
    const rect = xBandRect({ min: 4000, max: 8000 }, (v) => 1000 - v / 10, bbox)
    expect(rect).toEqual({ x: 200, y: 10, width: 400, height: 200 })
  })

  it('returns null for a zero-width (degenerate) band', () => {
    expect(xBandRect({ min: 5000, max: 5000 }, (v) => v / 10, bbox)).toBeNull()
  })

  it('returns null when either mapped edge is non-finite (e.g. scale not yet established)', () => {
    expect(xBandRect({ min: 4000, max: 8000 }, () => NaN, bbox)).toBeNull()
    expect(xBandRect({ min: 4000, max: 8000 }, (v) => (v === 4000 ? Infinity : v / 10), bbox)).toBeNull()
  })

  it('passes bbox.top/height through unchanged', () => {
    const rect = xBandRect({ min: 0, max: 100 }, (v) => v, { top: 42, height: 999 })
    expect(rect?.y).toBe(42)
    expect(rect?.height).toBe(999)
  })
})

// ── Mount-level smoke test ──────────────────────────────────────────────
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

const DATA: uPlot.AlignedData = [
  [0, 1000, 5000, 9000],
  [0, 10, 40, 80],
] as unknown as uPlot.AlignedData
const SERIES: uPlot.Series[] = [{}, { stroke: 'red' }]

function mountChart(extra: Record<string, unknown> = {}) {
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })
  return mount(UPlotChart, { props: { data: DATA, series: SERIES, ...extra }, global: { plugins: [i18n] } })
}

describe('UPlotChart — xBands prop (mount smoke test)', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    installFakeCanvasContext()
    setActivePinia(createPinia())
  })

  it('mounts without throwing when xBands is passed', () => {
    expect(() => mountChart({ xBands: [{ min: 4000, max: 8000 }] })).not.toThrow()
  })

  it('mounts without throwing when xBands is omitted (default behaviour unaffected)', () => {
    expect(() => mountChart()).not.toThrow()
  })

  it('does not throw when xBands changes reactively after mount', async () => {
    const wrapper = mountChart({ xBands: [{ min: 4000, max: 8000 }] })
    await expect(wrapper.setProps({ xBands: [{ min: 1000, max: 2000 }] })).resolves.not.toThrow()
  })
})
