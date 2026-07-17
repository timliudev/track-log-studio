// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MapBackgroundControls from '@/features/analyzer/MapBackgroundControls.vue'
import { defaultMapBackgroundSettings } from '@/domain/analysis/mapBackground'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * B60 — 使用者於 Android Chrome 實機回報「底圖」區塊的收折控制不會顯示（桌面
 * 正常）。舊實作是裸 <details>/<summary>，收折箭頭是瀏覽器 UA 預設畫出來的
 * disclosure marker，不同引擎/平台呈現不保證一致。改成常駐可見的按鈕 +
 * 內嵌 SVG 箭頭後，這裡釘住：預設收合、點擊會切換 aria-expanded 與內容區塊
 * 的顯示/隱藏 —— 這條路徑完全不吃任何 UA 預設樣式，理論上與平台無關；
 * 但實際渲染仍需在 Android 裝置上跑一次確認（測試無法涵蓋瀏覽器層級的
 * 渲染差異本身，只能釘住我方的邏輯與標記）。
 */
function mountControls() {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  return mount(MapBackgroundControls, {
    props: { settings: defaultMapBackgroundSettings(), hasImage: false },
    global: { plugins: [i18n] },
  })
}

describe('MapBackgroundControls collapse toggle (B60)', () => {
  it('starts collapsed: toggle button visible, body hidden', () => {
    const wrapper = mountControls()
    const toggle = wrapper.get('button.toggle')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.background-controls').exists()).toBe(false)
    // 常駐文字標籤 + SVG 箭頭都要在，不靠 UA marker。
    expect(toggle.text()).toContain('底圖')
    expect(toggle.find('svg.chevron').exists()).toBe(true)
  })

  it('expands the body and flips aria-expanded on click', async () => {
    const wrapper = mountControls()
    const toggle = wrapper.get('button.toggle')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.background-controls').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('IndexedDB')
    expect(wrapper.text()).not.toContain('localStorage')
  })

  it('collapses again on a second click', async () => {
    const wrapper = mountControls()
    const toggle = wrapper.get('button.toggle')
    await toggle.trigger('click')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.background-controls').exists()).toBe(false)
  })
})
