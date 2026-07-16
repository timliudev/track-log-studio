// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import LapTable from '@/features/analyzer/LapTable.vue'
import { useLapStore } from '@/stores/lapStore'
import zhHant from '@/i18n/locales/zh-Hant'
import type { Lap } from '@/domain/model/Lap'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'

const laps: Lap[] = [
  { index: 0, startIdx: 0, endIdx: 1, lapTimeMs: 45_000 },
  { index: 1, startIdx: 1, endIdx: 2, lapTimeMs: 46_000 },
]

const track: GpsTrack = {
  lat: new Float64Array([23, 23, 23]),
  lon: new Float64Array([120, 120.001, 120.002]),
  valid: new Uint8Array([1, 1, 1]),
}

beforeEach(() => setActivePinia(createPinia()))

describe('LapTable validity-band hint', () => {
  it('guides the user to the band controls when every detected lap is auto-excluded', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const lapStore = useLapStore()
    lapStore.setLaps(laps)
    lapStore.setTrack(track)
    lapStore.setLapTimeBand({ minSec: 60, maxSec: 70 })

    const wrapper = mount(LapTable, {
      props: { laps, track, timeMs: null, session: null, hasEcuLaps: false },
      global: {
        plugins: [pinia, createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
        directives: { tooltip: {} },
      },
    })

    expect(wrapper.text()).toContain('偵測到的 2 圈皆被有效圈區間自動排除')
  })
})
