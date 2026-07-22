import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { useSuspensionStore } from '@/stores/suspensionStore'

const V2_KEY = 'tracklogstudio.suspension.v2'
const V1_KEY = 'tracklogstudio.suspension.v1'

/** Node's test environment has no real localStorage (Vitest runs with
 *  `environment: 'node'`), so stub an in-memory implementation — same
 *  approach other persistence tests in this repo use (see drivetrainStore.test.ts). */
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
  setActivePinia(createPinia())
})

describe('suspensionStore', () => {
  it('defaults to disabled front/rear with SuspensionAD1/AD2 source channels', () => {
    const s = useSuspensionStore()
    expect(s.config.front.enabled).toBe(false)
    expect(s.config.front.sourceChannel).toBe('SuspensionAD1')
    expect(s.config.rear.sourceChannel).toBe('SuspensionAD2')
    expect(s.config.front.maxMv).toBe(5000)
  })

  it('setChannel patches one channel without touching the rest', () => {
    const s = useSuspensionStore()
    s.setChannel('front', { enabled: true, maxMm: 120 })
    expect(s.config.front.enabled).toBe(true)
    expect(s.config.front.maxMm).toBe(120)
    expect(s.config.front.sourceChannel).toBe('SuspensionAD1')
    expect(s.config.rear.enabled).toBe(false)
  })

  it('setChannel can repoint sourceChannel at any channel name (format-agnostic)', () => {
    const s = useSuspensionStore()
    s.setChannel('rear', { sourceChannel: 'Analog_Channel_3' })
    expect(s.config.rear.sourceChannel).toBe('Analog_Channel_3')
  })

  it('replaces the complete calibration only through the explicit replace action', () => {
    const s = useSuspensionStore()
    const imported = {
      front: { enabled: true, sourceChannel: 'ImportedFront', minMv: 100, maxMv: 4900, zeroMv: 500, minMm: 0, maxMm: 120 },
      rear: { enabled: true, sourceChannel: 'ImportedRear', minMv: 50, maxMv: 4950, zeroMv: 450, minMm: 0, maxMm: 110 },
    }
    expect(s.replaceConfig(imported)).toBe(true)
    expect(s.config).toEqual(imported)
    expect(s.replaceConfig({ front: {} })).toBe(false)
    expect(s.config).toEqual(imported)
  })

  it('reset restores defaults', () => {
    const s = useSuspensionStore()
    s.setChannel('front', { enabled: true })
    s.reset()
    expect(s.config.front.enabled).toBe(false)
  })

  it('persists to the v2 storage key', async () => {
    const s = useSuspensionStore()
    s.setChannel('front', { enabled: true, maxMm: 88 })
    await nextTick()
    const raw = localStorage.getItem(V2_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.front.maxMm).toBe(88)
  })
})

describe('suspensionStore v1 -> v2 migration', () => {
  it('migrates a legacy v1 payload (source: AD1/AD2) into v2 sourceChannel shape, preserving values', () => {
    localStorage.setItem(
      V1_KEY,
      JSON.stringify({
        front: { enabled: true, source: 'AD1', minMv: 100, maxMv: 4900, zeroMv: 500, minMm: 0, maxMm: 130 },
        rear: { enabled: false, source: 'AD2', minMv: 0, maxMv: 5000, zeroMv: 0, minMm: 0, maxMm: 0 },
      }),
    )
    const s = useSuspensionStore()
    expect(s.config.front.enabled).toBe(true)
    expect(s.config.front.sourceChannel).toBe('SuspensionAD1')
    expect(s.config.front.minMv).toBe(100)
    expect(s.config.front.maxMv).toBe(4900)
    expect(s.config.front.zeroMv).toBe(500)
    expect(s.config.front.maxMm).toBe(130)
    expect(s.config.rear.sourceChannel).toBe('SuspensionAD2')
  })

  it('leaves the legacy v1 key untouched on disk (only v2 is written on the next change)', async () => {
    const legacyRaw = JSON.stringify({
      front: { enabled: true, source: 'AD1', minMv: 0, maxMv: 5000, zeroMv: 0, minMm: 0, maxMm: 120 },
      rear: { enabled: false, source: 'AD2', minMv: 0, maxMv: 5000, zeroMv: 0, minMm: 0, maxMm: 0 },
    })
    localStorage.setItem(V1_KEY, legacyRaw)
    const s = useSuspensionStore()
    s.setChannel('rear', { enabled: true })
    await nextTick()
    expect(localStorage.getItem(V1_KEY)).toBe(legacyRaw)
    expect(localStorage.getItem(V2_KEY)).toBeTruthy()
  })

  it('prefers v2 data over a stale v1 key when both are present', () => {
    localStorage.setItem(
      V1_KEY,
      JSON.stringify({ front: { enabled: false, source: 'AD1', minMv: 0, maxMv: 5000, zeroMv: 0, minMm: 0, maxMm: 0 } }),
    )
    localStorage.setItem(
      V2_KEY,
      JSON.stringify({
        front: { enabled: true, sourceChannel: 'Custom_Pot', minMv: 0, maxMv: 5000, zeroMv: 0, minMm: 0, maxMm: 150 },
      }),
    )
    const s = useSuspensionStore()
    expect(s.config.front.enabled).toBe(true)
    expect(s.config.front.sourceChannel).toBe('Custom_Pot')
    expect(s.config.front.maxMm).toBe(150)
  })

  it('falls back to defaults when neither key nor a valid payload exists', () => {
    const s = useSuspensionStore()
    expect(s.config.front.sourceChannel).toBe('SuspensionAD1')
    expect(s.config.front.enabled).toBe(false)
  })

  it('does not throw and falls back to defaults on corrupt v1 JSON', () => {
    localStorage.setItem(V1_KEY, '{not valid json')
    const s = useSuspensionStore()
    expect(s.config.front.sourceChannel).toBe('SuspensionAD1')
  })
})
