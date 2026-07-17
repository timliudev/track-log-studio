// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import CvtDynamicsCard from '@/features/analyzer/CvtDynamicsCard.vue'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { openBeltLengthMm } from '@/domain/analysis/cvtDynamics'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

function channel(name: string, values: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(values) }
}

const session = new LogSession([
  channel('RPM', [6000, 7000, 8000]),
  channel('GPS_Speed', [60, 70, 80]),
], { formatId: 'test', createdDate: null, headerInfo: {} })

function mountCard(cursorIdx = 0) {
  return mount(CvtDynamicsCard, {
    props: { session, fileId: 7, cursorIdx },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })],
    },
  })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  setActivePinia(createPinia())
})

describe('CvtDynamicsCard', () => {
  it('shows an explicit disabled level when physical geometry is missing', async () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }))
    const wrapper = mountCard()
    callbacks.shift()?.(0)
    await nextTick()
    expect(wrapper.text()).toContain('此層級未啟用')
    expect(wrapper.text()).toContain('齒輪組與終傳')
  })

  it('updates the existing SVG through one rAF callback instead of rebuilding it per cursor move', async () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }))
    const drivetrain = useDrivetrainStore()
    drivetrain.setKind('cvt')
    drivetrain.setCvtWheelCircumferenceMm(1000)
    drivetrain.updateCvtProfile(drivetrain.activeCvtProfile.id, {
      gearReduction: { mode: 'ratio', ratio: 1 },
      finalReduction: { mode: 'ratio', ratio: 1.5 },
      belt: { lengthSource: 'pitch', pitchLengthMm: openBeltLengthMm(20, 80, 190) },
      geometry: {
        centerDistanceMm: 190,
        frontSheaveAngle: { valueDeg: 14, basis: 'half' },
        rearSheaveAngle: { valueDeg: 14, basis: 'half' },
        frontRadiusBoundsMm: { min: 15, max: 70 },
        rearRadiusBoundsMm: { min: 30, max: 100 },
        frontReferenceRadiusMm: 20,
        rearReferenceRadiusMm: 80,
      },
    })

    const wrapper = mountCard(0)
    expect(callbacks).toHaveLength(1)
    callbacks.shift()?.(0)
    await nextTick()
    const belt = wrapper.find('path.belt').element
    expect(wrapper.text()).toContain('4.000')
    expect(wrapper.text()).toContain('幾何已啟用')

    await wrapper.setProps({ cursorIdx: 1 })
    await wrapper.setProps({ cursorIdx: 2 })
    expect(callbacks).toHaveLength(1)
    callbacks.shift()?.(16)
    await nextTick()
    expect(wrapper.find('path.belt').element).toBe(belt)
  })

  it('keeps the compact card small and moves the full bilingual boundary into a settings sheet', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const wrapper = mountCard()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await wrapper.find('.settings-button').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('不代表零件安全保證或馬力機實測')
  })

  it('labels electronic actuation as observation-only instead of applying roller force', async () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    const drivetrain = useDrivetrainStore()
    drivetrain.setKind('cvt')
    drivetrain.updateCvtProfile(drivetrain.activeCvtProfile.id, { actuationKind: 'electronic' })
    const wrapper = mountCard()
    callbacks.shift()?.(0)
    await nextTick()
    expect(wrapper.text()).toContain('電子致動 CVT')
    expect(wrapper.text()).toContain('不套用滾珠離心力')
  })

  it('shows a force equilibrium only after every required physical layer is explicit', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const drivetrain = useDrivetrainStore()
    drivetrain.updateCvtProfile(drivetrain.activeCvtProfile.id, {
      belt: { lengthSource: 'pitch', pitchLengthMm: 800 },
      geometry: {
        centerDistanceMm: 250,
        frontSheaveAngle: { valueDeg: 14, basis: 'half' },
        rearSheaveAngle: { valueDeg: 14, basis: 'half' },
        frontRadiusBoundsMm: { min: 32, max: 70 },
        rearRadiusBoundsMm: { min: 32, max: 70 },
        frontReferenceRadiusMm: 32,
        rearReferenceRadiusMm: 70,
      },
      force: {
        operatingFrontRpm: 3000,
        operatingRearTorqueNm: 0,
        roller: {
          massesG: [9, 9, 9, 9, 9, 9],
          track: [{ travelMm: 0, radiusMm: 25 }, { travelMm: 20, radiusMm: 45 }],
          efficiency: 1,
        },
        spring: { mode: 'linear', rateNPerMm: 8, installedPreloadMm: 10 },
        couplingMode: 'ideal',
      },
    })
    const wrapper = mountCard()
    await nextTick()
    expect(wrapper.text()).toContain('力平衡根')
    expect(wrapper.text()).toContain('尚未評估 slip margin')
    expect(wrapper.find('.force-chart').exists()).toBe(true)
  })
})
