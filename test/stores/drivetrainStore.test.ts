import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { useDrivetrainStore } from '@/stores/drivetrainStore'

const STORAGE_KEY = 'aracer-loga.drivetrain.v1'

/** Node's test environment has no real localStorage (Vitest runs with
 *  `environment: 'node'`), so stub an in-memory implementation — same
 *  approach other persistence tests in this repo use for idb mocks. */
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

describe('drivetrainStore persistence', () => {
  it('defaults to MT with the built-in spec when nothing is persisted', () => {
    const s = useDrivetrainStore()
    expect(s.kind).toBe('mt')
    expect(s.mt.gearRatios).toEqual([2.615, 1.812, 1.409, 1.16, 1.0, 0.885])
  })

  it('auto-saves kind/mt/cvt/inversion changes to localStorage', async () => {
    const s = useDrivetrainStore()
    s.setKind('cvt')
    s.setCvt({ ratioLow: 3.1 })
    s.setInversionWheelCircumferenceMm(1999)
    await nextTick()

    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const data = JSON.parse(raw as string)
    expect(data.kind).toBe('cvt')
    expect(data.cvt.ratioLow).toBe(3.1)
    expect(data.inversionWheelCircumferenceMm).toBe(1999)
  })

  it('restores persisted state on next store init (reload simulation)', async () => {
    const s1 = useDrivetrainStore()
    s1.setKind('cvt')
    s1.setGearCount(4)
    s1.setGearRatio(2, 1.5)
    s1.setMt({ redlineRpm: 12000 })
    await nextTick()

    // Simulate a reload: fresh pinia instance re-reads localStorage.
    setActivePinia(createPinia())
    const s2 = useDrivetrainStore()
    expect(s2.kind).toBe('cvt')
    expect(s2.mt.gearRatios).toHaveLength(4)
    expect(s2.mt.gearRatios[1]).toBe(1.5)
    expect(s2.mt.redlineRpm).toBe(12000)
  })

  it('falls back to defaults when persisted JSON is corrupt', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    const s = useDrivetrainStore()
    expect(s.kind).toBe('mt')
    expect(s.mt.gearRatios).toEqual([2.615, 1.812, 1.409, 1.16, 1.0, 0.885])
  })

  it('does not leak a shared gearRatios array reference with the default constant', async () => {
    const s1 = useDrivetrainStore()
    s1.setGearRatio(1, 9.99)
    await nextTick()

    setActivePinia(createPinia())
    const s2 = useDrivetrainStore()
    // Second store must reload from persisted storage (which now has 9.99),
    // not from a mutated shared DEFAULT_MT reference.
    expect(s2.mt.gearRatios[0]).toBe(9.99)
  })
})
