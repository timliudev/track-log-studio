import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { useDrivetrainStore, toMtDrivetrainSpec } from '@/stores/drivetrainStore'

const STORAGE_KEY = 'aracer-loga.drivetrain.v2'
const OLD_V1_STORAGE_KEY = 'aracer-loga.drivetrain.v1'

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
    expect(s.mt.gearRatios.map((g) => g.ratio)).toEqual([2.615, 1.812, 1.409, 1.16, 1.0, 0.885])
    expect(s.mt.finalDrive).toEqual({ mode: 'teeth', ratio: 0, frontTeeth: 15, rearTeeth: 45 })
  })

  it('defaults CVT to the free-form note fields (no computed geometry fields)', () => {
    const s = useDrivetrainStore()
    expect(s.cvt.notes.length).toBeGreaterThan(0)
    expect(s.cvt.notes.some((n) => n.label.includes('終傳'))).toBe(true)
    expect(s.cvt.notes.every((n) => n.value === '')).toBe(true)
  })

  it('auto-saves kind/mt/cvt/inversion changes to localStorage', async () => {
    const s = useDrivetrainStore()
    s.setKind('cvt')
    s.setCvtNote(0, { value: '48mm' })
    s.setInversionWheelCircumferenceMm(1999)
    await nextTick()

    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const data = JSON.parse(raw as string)
    expect(data.kind).toBe('cvt')
    expect(data.cvt.notes[0].value).toBe('48mm')
    expect(data.inversionWheelCircumferenceMm).toBe(1999)
  })

  it('restores persisted state on next store init (reload simulation)', async () => {
    const s1 = useDrivetrainStore()
    s1.setKind('cvt')
    s1.setGearCount(4)
    s1.setGearRatio(2, { ratio: 1.5 })
    s1.setMt({ redlineRpm: 12000 })
    await nextTick()

    // Simulate a reload: fresh pinia instance re-reads localStorage.
    setActivePinia(createPinia())
    const s2 = useDrivetrainStore()
    expect(s2.kind).toBe('cvt')
    expect(s2.mt.gearRatios).toHaveLength(4)
    expect(s2.mt.gearRatios[1].ratio).toBe(1.5)
    expect(s2.mt.redlineRpm).toBe(12000)
  })

  it('falls back to defaults when persisted JSON is corrupt', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    const s = useDrivetrainStore()
    expect(s.kind).toBe('mt')
    expect(s.mt.gearRatios.map((g) => g.ratio)).toEqual([2.615, 1.812, 1.409, 1.16, 1.0, 0.885])
  })

  it('does not leak a shared gearRatios array reference with the default constant', async () => {
    const s1 = useDrivetrainStore()
    s1.setGearRatio(1, { ratio: 9.99 })
    await nextTick()

    setActivePinia(createPinia())
    const s2 = useDrivetrainStore()
    // Second store must reload from persisted storage (which now has 9.99),
    // not from a mutated shared DEFAULT_MT reference.
    expect(s2.mt.gearRatios[0].ratio).toBe(9.99)
  })

  it('starts fresh from defaults (no crash) when only an old v1 payload is present', () => {
    // Old v1 shape: gearRatios was number[], cvt had ratioLow/ratioHigh/etc.
    // — structurally incompatible with v2. It's stored under a DIFFERENT key
    // (v1), so a v2 store simply finds nothing at its own key and defaults;
    // this test guards against a future key-unification regression that
    // might try to read the v1 payload directly under the v2 shape.
    localStorage.setItem(
      OLD_V1_STORAGE_KEY,
      JSON.stringify({
        kind: 'cvt',
        mt: { primaryReduction: 2.833, gearRatios: [2.615, 1.812], frontSprocketTeeth: 15, rearSprocketTeeth: 45 },
        cvt: { ratioLow: 2.4, ratioHigh: 0.9, finalReduction: 8, wheelCircumferenceMm: 1400, maxRpm: 8000 },
        inversionWheelCircumferenceMm: 1870,
      }),
    )
    expect(() => useDrivetrainStore()).not.toThrow()
    const s = useDrivetrainStore()
    expect(s.kind).toBe('mt')
    expect(s.mt.gearRatios.map((g) => g.ratio)).toEqual([2.615, 1.812, 1.409, 1.16, 1.0, 0.885])
  })

  it('ignores a v1-shaped payload found under the v2 key without crashing', () => {
    // Defensive: if a v1 payload somehow ended up under the v2 key (e.g. a
    // hand-edited/corrupted browser profile), the shape guard should reject
    // it and fall back to v2 defaults rather than spread v1's incompatible
    // fields (e.g. numeric gearRatios) into v2 state.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        kind: 'cvt',
        mt: { primaryReduction: 2.833, gearRatios: [2.615, 1.812], frontSprocketTeeth: 15, rearSprocketTeeth: 45 },
        cvt: { ratioLow: 2.4, ratioHigh: 0.9, finalReduction: 8, wheelCircumferenceMm: 1400, maxRpm: 8000 },
        inversionWheelCircumferenceMm: 1870,
      }),
    )
    expect(() => useDrivetrainStore()).not.toThrow()
    const s = useDrivetrainStore()
    expect(s.mt.gearRatios.every((g) => typeof g === 'object' && 'mode' in g)).toBe(true)
    expect(s.cvt.notes.length).toBeGreaterThan(0)
  })
})

describe('toMtDrivetrainSpec', () => {
  it('forwards ratio-mode gears/final-drive and direct circumference', () => {
    const s = useDrivetrainStore()
    const spec = toMtDrivetrainSpec(s.mt)
    expect(spec.gearRatios[0]).toEqual({ ratio: 2.615 })
    // Default finalDrive mode is 'teeth' in DEFAULT_MT.
    expect(spec.finalDrive).toEqual({ frontTeeth: 15, rearTeeth: 45 })
    expect(spec.wheelCircumferenceMm).toBe(1870)
  })

  it('resolves circumference from a tire spec when circumferenceMode is "tire"', () => {
    const s = useDrivetrainStore()
    s.setMt({ circumferenceMode: 'tire', tireSpec: '120/70-17' })
    const spec = toMtDrivetrainSpec(s.mt)
    expect(spec.wheelCircumferenceMm).toBeCloseTo(1884.33, 1)
  })

  it('only forwards the active mode for a gear (does not leak the inactive field)', () => {
    const s = useDrivetrainStore()
    s.setGearRatio(1, { mode: 'teeth', drivenTeeth: 47, driveTeeth: 18 })
    const spec = toMtDrivetrainSpec(s.mt)
    expect(spec.gearRatios[0]).toEqual({ drivenTeeth: 47, driveTeeth: 18 })
  })

  it('treats a non-positive primaryReduction as unset (direct-drive)', () => {
    const s = useDrivetrainStore()
    s.setMt({ primaryReduction: 0 })
    const spec = toMtDrivetrainSpec(s.mt)
    expect(spec.primaryReduction).toBeUndefined()
  })
})
