import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  useDrivetrainStore,
  toMtDrivetrainSpec,
  MAX_GEARS,
  mergeMtFormState,
  mergeCvtFormState,
  mergeCvtProfile,
} from '@/stores/drivetrainStore'

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
    expect(s.kindSelection).toBe('auto')
    expect(s.mt.gearRatios.map((g) => g.ratio)).toEqual([2.615, 1.812, 1.409, 1.16, 1.0, 0.885])
    expect(s.mt.finalDrive).toEqual({ mode: 'teeth', ratio: 0, frontTeeth: 15, rearTeeth: 45 })
  })

  it('defaults CVT to one incomplete profile without guessed physical values', () => {
    const s = useDrivetrainStore()
    expect(s.cvt.notes.length).toBeGreaterThan(0)
    expect(s.cvt.notes.some((n) => n.label.includes('終傳'))).toBe(true)
    expect(s.cvt.notes.every((n) => n.value === '')).toBe(true)
    expect(s.cvt.profiles).toHaveLength(1)
    expect(s.activeCvtProfile.id).toBe(s.cvt.activeProfileId)
    expect(s.activeCvtProfile.belt.outsideLengthMm).toBeNull()
    expect(s.activeCvtProfile.geometry.centerDistanceMm).toBeNull()
    expect(s.activeCvtProfile.geometry.frontSheaveAngle.valueDeg).toBeNull()
    expect(s.activeCvtProfile.gearReduction.ratio).toBe(0)
  })

  it('persists profile geometry and keeps wheel conversion synced to the active profile', async () => {
    const s1 = useDrivetrainStore()
    s1.updateCvtProfile(s1.activeCvtProfile.id, {
      name: 'NMAX race',
      belt: { outsideLengthMm: 882, cordOffsetFromOutsideMm: 2.7 },
      geometry: {
        centerDistanceMm: 205,
        frontSheaveAngle: { valueDeg: 13.8, basis: 'half' },
        frontRadiusBoundsMm: { min: 23, max: 58 },
      },
      finalReduction: {
        mode: 'stages',
        stages: [
          { driveTeeth: 13, drivenTeeth: 41 },
          { driveTeeth: 12, drivenTeeth: 36 },
        ],
      },
    })
    s1.setCvtTireSpec('100/90-10')
    await nextTick()

    setActivePinia(createPinia())
    const s2 = useDrivetrainStore()
    expect(s2.activeCvtProfile.name).toBe('NMAX race')
    expect(s2.activeCvtProfile.belt.outsideLengthMm).toBe(882)
    expect(s2.activeCvtProfile.geometry.frontSheaveAngle.valueDeg).toBe(13.8)
    expect(s2.activeCvtProfile.finalReduction.stages).toHaveLength(2)
    expect(s2.activeCvtProfile.tireSpec).toBe('100/90-10')
    expect(s2.activeCvtProfile.wheelCircumferenceMm).toBe(s2.cvt.wheelCircumferenceMm)
  })

  it('adds, switches, duplicates and removes independent CVT profiles', () => {
    const s = useDrivetrainStore()
    const first = s.activeCvtProfile.id
    s.updateCvtProfile(first, { name: 'Road' })
    const second = s.addCvtProfile('Race')
    s.updateCvtProfile(second, { actuationKind: 'electronic', vehicleId: 'nmax-turbo' })
    expect(s.cvt.profiles).toHaveLength(2)
    expect(s.activeCvtProfile.actuationKind).toBe('electronic')
    s.setActiveCvtProfile(first)
    expect(s.activeCvtProfile.name).toBe('Road')
    const duplicate = s.duplicateCvtProfile(second)
    expect(duplicate).not.toBeNull()
    expect(s.activeCvtProfile.vehicleId).toBe('nmax-turbo')
    s.removeCvtProfile(duplicate!)
    expect(s.cvt.profiles).toHaveLength(2)
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
    expect(data.kindSelection).toBe('manual')
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
    expect(s2.kindSelection).toBe('manual')
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

  it('allows session inference until the user explicitly chooses a tab', () => {
    const s = useDrivetrainStore()
    expect(s.applyDetectedKind('cvt')).toBe(true)
    expect(s.kind).toBe('cvt')
    expect(s.kindSelection).toBe('auto')

    s.setKind('mt')
    expect(s.kindSelection).toBe('manual')
    expect(s.applyDetectedKind('cvt')).toBe(false)
    expect(s.kind).toBe('mt')
  })

  it('migrates an existing unmarked v2 kind as manual so inference cannot overwrite it', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ kind: 'cvt', mt: {}, cvt: {}, inversionWheelCircumferenceMm: 1870 }),
    )
    const s = useDrivetrainStore()
    expect(s.kind).toBe('cvt')
    expect(s.kindSelection).toBe('manual')
    expect(s.applyDetectedKind('mt')).toBe(false)
    expect(s.kind).toBe('cvt')
  })

  it('restores an explicitly auto-marked profile and keeps following inference', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ kind: 'mt', kindSelection: 'auto', mt: {}, cvt: {}, inversionWheelCircumferenceMm: 1870 }),
    )
    const s = useDrivetrainStore()
    expect(s.kindSelection).toBe('auto')
    expect(s.applyDetectedKind('cvt')).toBe(true)
    expect(s.kind).toBe('cvt')
  })
})

describe('setTireSpec — live conversion + auto-apply (2026-07-08 user decision)', () => {
  it('auto-applies a valid spec into the circumference (rounded whole mm)', () => {
    const s = useDrivetrainStore()
    expect(s.setTireSpec('100/90-10')).toBe(true)
    // 100/90-10 -> π * 434mm, rounded to whole mm for a tweakable field.
    expect(s.mt.wheelCircumferenceMm).toBe(Math.round(Math.PI * 434))
    expect(s.mt.circumferenceMode).toBe('direct')
    expect(s.mt.tireSpec).toBe('100/90-10')
  })

  it('the default spec and default circumference agree (retyping it is a visible no-op, not a dead control)', () => {
    const s = useDrivetrainStore()
    // DEFAULT_MT pins mm to its own spec's conversion — the "effective
    // change" rule below relies on this to behave sanely on a fresh panel.
    expect(s.mt.tireSpec).toBe('120/70-17')
    expect(s.mt.wheelCircumferenceMm).toBe(1884)
    expect(s.setTireSpec('120/70-17')).toBe(false) // same geometry — nothing to re-apply
    expect(s.mt.wheelCircumferenceMm).toBe(1884)
  })

  it('applies again on every EFFECTIVE spec change (real size change overwrites)', () => {
    const s = useDrivetrainStore()
    s.setTireSpec('120/70-17')
    expect(s.setTireSpec('120/80-12')).toBe(true)
    expect(s.mt.wheelCircumferenceMm).toBe(Math.round(Math.PI * 496.8))
  })

  it('stores an unparsable (mid-edit) spec WITHOUT touching the circumference', () => {
    const s = useDrivetrainStore()
    s.setTireSpec('120/70-17')
    expect(s.setTireSpec('120/70-')).toBe(false) // user still typing
    expect(s.mt.tireSpec).toBe('120/70-') // text kept
    expect(s.mt.wheelCircumferenceMm).toBe(1884) // value stays
  })

  it('a manual mm fine-tune never touches the spec field', () => {
    const s = useDrivetrainStore()
    s.setTireSpec('120/80-12')
    const applied = s.mt.wheelCircumferenceMm
    s.setMt({ wheelCircumferenceMm: applied - 20 })
    expect(s.mt.wheelCircumferenceMm).toBe(applied - 20)
    expect(s.mt.tireSpec).toBe('120/80-12')
  })

  it('a COSMETIC spec edit (same resolved geometry) does not stomp a manual tweak', () => {
    const s = useDrivetrainStore()
    s.setTireSpec('120/70-17') // -> 1884
    s.setMt({ wheelCircumferenceMm: 1850 }) // manual fine-tune
    // Same geometry, different writing: construction letter + speed rating.
    expect(s.setTireSpec('120/70ZR17 58W')).toBe(false)
    expect(s.mt.wheelCircumferenceMm).toBe(1850) // tweak survives
    expect(s.mt.tireSpec).toBe('120/70ZR17 58W') // text still updated
  })

  it('a REAL size change after a manual tweak overwrites the tweak (spec is authoritative)', () => {
    const s = useDrivetrainStore()
    s.setTireSpec('120/70-17')
    s.setMt({ wheelCircumferenceMm: 1850 })
    expect(s.setTireSpec('180/55-17')).toBe(true)
    expect(s.mt.wheelCircumferenceMm).toBe(Math.round(Math.PI * (17 * 25.4 + 2 * 99)))
  })

  it('recovering from an invalid spec re-applies even at the same size as before', () => {
    const s = useDrivetrainStore()
    s.setTireSpec('120/70-17')
    s.setMt({ wheelCircumferenceMm: 1850 })
    s.setTireSpec('garbage') // invalid — mm untouched (1850)
    // Valid again: previous spec was unparsable, so this counts as effective.
    expect(s.setTireSpec('120/70-17')).toBe(true)
    expect(s.mt.wheelCircumferenceMm).toBe(1884)
  })

  it('persists the auto-applied circumference and spec', async () => {
    const s1 = useDrivetrainStore()
    s1.setTireSpec('100/90-10')
    await nextTick()

    setActivePinia(createPinia())
    const s2 = useDrivetrainStore()
    expect(s2.mt.circumferenceMode).toBe('direct')
    expect(s2.mt.wheelCircumferenceMm).toBe(Math.round(Math.PI * 434))
    expect(s2.mt.tireSpec).toBe('100/90-10')
  })
})

describe('legacy tire-mode migration (pre-live-conversion payloads)', () => {
  it('resolves a persisted "tire" mode into the mm field once at init', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        kind: 'mt',
        mt: {
          circumferenceMode: 'tire',
          tireSpec: '120/70-17',
          wheelCircumferenceMm: 1870, // stale direct value from before 'tire' was active
        },
        cvt: { wheelCircumferenceMm: 1400, notes: [] },
        inversionWheelCircumferenceMm: 1870,
      }),
    )
    const s = useDrivetrainStore()
    // Same effective circumference the old 'tire' mode computed live.
    expect(s.mt.circumferenceMode).toBe('direct')
    expect(s.mt.wheelCircumferenceMm).toBe(1884)
    expect(s.mt.tireSpec).toBe('120/70-17')
  })

  it('falls back to the stored mm when a "tire" payload has an unparsable spec', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        kind: 'mt',
        mt: { circumferenceMode: 'tire', tireSpec: 'garbage', wheelCircumferenceMm: 1870 },
        cvt: { wheelCircumferenceMm: 1400, notes: [] },
        inversionWheelCircumferenceMm: 1870,
      }),
    )
    const s = useDrivetrainStore()
    expect(s.mt.circumferenceMode).toBe('direct')
    expect(s.mt.wheelCircumferenceMm).toBe(1870)
  })
})

describe('#7/#12 — gear count is adjustable 1..8 (was hardcoded to 6)', () => {
  it('raises the ceiling to 8 gears', () => {
    expect(MAX_GEARS).toBe(8)
  })

  it('setGearCount can grow past the old 6-gear ceiling up to 8', () => {
    const s = useDrivetrainStore()
    s.setGearCount(8)
    expect(s.mt.gearRatios).toHaveLength(8)
    // Newly-added gears zero-pad (same rule as growing within the old range).
    expect(s.mt.gearRatios[6].ratio).toBe(0)
    expect(s.mt.gearRatios[7].ratio).toBe(0)
  })

  it('setGearCount can shrink to as few as 1 gear (off-road/CUB bikes)', () => {
    const s = useDrivetrainStore()
    s.setGearCount(1)
    expect(s.mt.gearRatios).toHaveLength(1)
    expect(s.mt.gearRatios[0].ratio).toBe(2.615) // first gear's ratio survives the truncation
  })

  it('clamps a count above the new MAX_GEARS ceiling', () => {
    const s = useDrivetrainStore()
    s.setGearCount(99)
    expect(s.mt.gearRatios).toHaveLength(8)
  })

  it('setGearRatio on the newly-reachable gears 7/8 works (was rejected as > old MAX_GEARS=6)', () => {
    const s = useDrivetrainStore()
    s.setGearCount(8)
    s.setGearRatio(7, { ratio: 0.7 })
    s.setGearRatio(8, { ratio: 0.6 })
    expect(s.mt.gearRatios[6].ratio).toBe(0.7)
    expect(s.mt.gearRatios[7].ratio).toBe(0.6)
  })

  it('an old persisted 6-gear payload keeps its original length on load (no forced backfill to 8)', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        kind: 'mt',
        mt: { gearRatios: [2.615, 1.812, 1.409, 1.16, 1.0, 0.885].map((ratio) => ({ mode: 'ratio', ratio, drivenTeeth: 0, driveTeeth: 0 })) },
        cvt: { wheelCircumferenceMm: 1400, notes: [] },
        inversionWheelCircumferenceMm: 1870,
      }),
    )
    const s = useDrivetrainStore()
    expect(s.mt.gearRatios).toHaveLength(6)
  })
})

describe('#7/#12 — setCvtTireSpec: CVT gets the same tire-spec live conversion as MT', () => {
  it('defaults new profiles to the Taiwan scooter size 120/80-12', () => {
    const s = useDrivetrainStore()
    expect(s.cvt.tireSpec).toBe('120/80-12')
    expect(s.cvt.wheelCircumferenceMm).toBe(Math.round(Math.PI * 496.8))
  })

  it('auto-applies a valid spec into cvt.wheelCircumferenceMm (rounded whole mm)', () => {
    const s = useDrivetrainStore()
    expect(s.setCvtTireSpec('100/90-10')).toBe(true)
    expect(s.cvt.wheelCircumferenceMm).toBe(Math.round(Math.PI * 434))
    expect(s.cvt.tireSpec).toBe('100/90-10')
  })

  it('does not touch mt state at all (separate field per drivetrain kind)', () => {
    const s = useDrivetrainStore()
    const mtBefore = s.mt.wheelCircumferenceMm
    s.setCvtTireSpec('100/90-10')
    expect(s.mt.wheelCircumferenceMm).toBe(mtBefore)
    expect(s.mt.tireSpec).toBe('120/70-17')
  })

  it('a cosmetic re-spec (same resolved geometry) does not stomp a manual mm tweak', () => {
    const s = useDrivetrainStore()
    s.setCvtTireSpec('120/70-17')
    s.setCvtWheelCircumferenceMm(1850)
    expect(s.setCvtTireSpec('120/70ZR17 58W')).toBe(false)
    expect(s.cvt.wheelCircumferenceMm).toBe(1850)
  })

  it('a real size change overwrites a manual tweak (spec is authoritative)', () => {
    const s = useDrivetrainStore()
    s.setCvtTireSpec('120/70-17')
    s.setCvtWheelCircumferenceMm(1850)
    expect(s.setCvtTireSpec('180/55-17')).toBe(true)
    expect(s.cvt.wheelCircumferenceMm).toBe(Math.round(Math.PI * (17 * 25.4 + 2 * 99)))
  })

  it('an unparsable spec is stored as text without touching the circumference', () => {
    const s = useDrivetrainStore()
    s.setCvtTireSpec('120/70-17')
    const applied = s.cvt.wheelCircumferenceMm
    expect(s.setCvtTireSpec('120/70-')).toBe(false) // user still typing — doesn't parse
    expect(s.cvt.tireSpec).toBe('120/70-') // text kept
    expect(s.cvt.wheelCircumferenceMm).toBe(applied) // value untouched
  })

  it('persists the auto-applied spec and circumference', async () => {
    const s1 = useDrivetrainStore()
    s1.setCvtTireSpec('100/90-10')
    await nextTick()

    setActivePinia(createPinia())
    const s2 = useDrivetrainStore()
    expect(s2.cvt.tireSpec).toBe('100/90-10')
    expect(s2.cvt.wheelCircumferenceMm).toBe(Math.round(Math.PI * 434))
  })

  it('an old persisted CVT payload without tireSpec migrates cleanly (defaults to blank)', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        kind: 'cvt',
        mt: {},
        cvt: { wheelCircumferenceMm: 1450, notes: [{ label: '珠重', value: '18g' }] },
        inversionWheelCircumferenceMm: 1870,
      }),
    )
    const s = useDrivetrainStore()
    expect(s.cvt.tireSpec).toBe('')
    expect(s.cvt.wheelCircumferenceMm).toBe(1450) // pre-existing field untouched
    expect(s.cvt.notes[0].value).toBe('18g') // pre-existing notes untouched
  })
})

describe('toMtDrivetrainSpec', () => {
  it('forwards ratio-mode gears/final-drive and direct circumference', () => {
    const s = useDrivetrainStore()
    const spec = toMtDrivetrainSpec(s.mt)
    expect(spec.gearRatios[0]).toEqual({ ratio: 2.615 })
    // Default finalDrive mode is 'teeth' in DEFAULT_MT.
    expect(spec.finalDrive).toEqual({ frontTeeth: 15, rearTeeth: 45 })
    // Default mm mirrors the default tireSpec's conversion (see DEFAULT_MT).
    expect(spec.wheelCircumferenceMm).toBe(1884)
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

// B19 — settings export/import reuses these same merge functions (see
// domain/settings/settingsTransfer.ts's parseImportBundle) so an imported
// drivetrain payload is sanitized identically to a normal localStorage load.
describe('mergeMtFormState / mergeCvtFormState (B19 shared sanitizer)', () => {
  it('mergeMtFormState fills in every default field for an empty/undefined payload', () => {
    const merged = mergeMtFormState(undefined)
    expect(merged.gearRatios.map((g) => g.ratio)).toEqual([2.615, 1.812, 1.409, 1.16, 1.0, 0.885])
    expect(merged.finalDrive).toEqual({ mode: 'teeth', ratio: 0, frontTeeth: 15, rearTeeth: 45 })
    expect(merged.redlineRpm).toBe(10000)
  })

  it('mergeMtFormState accepts a well-shaped partial payload and overrides only what it has', () => {
    const merged = mergeMtFormState({ redlineRpm: 12000 })
    expect(merged.redlineRpm).toBe(12000)
    // Untouched fields keep their defaults.
    expect(merged.gearRatios).toHaveLength(6)
  })

  it('mergeMtFormState rejects a v1-shaped (numeric gearRatios) payload and falls back to defaults', () => {
    const merged = mergeMtFormState({ gearRatios: [2.615, 1.812] } as never)
    expect(merged.gearRatios.map((g) => g.ratio)).toEqual([2.615, 1.812, 1.409, 1.16, 1.0, 0.885])
  })

  it('mergeMtFormState does not leak a shared gearRatios array reference across calls', () => {
    const a = mergeMtFormState(undefined)
    const b = mergeMtFormState(undefined)
    a.gearRatios[0].ratio = 999
    expect(b.gearRatios[0].ratio).toBe(2.615)
  })

  it('mergeCvtFormState fills in default notes for an empty/undefined payload', () => {
    const merged = mergeCvtFormState(undefined)
    expect(merged.tireSpec).toBe('120/80-12')
    expect(merged.wheelCircumferenceMm).toBe(Math.round(Math.PI * 496.8))
    expect(merged.notes.length).toBeGreaterThan(0)
    expect(merged.notes.every((n) => n.value === '')).toBe(true)
    expect(merged.profiles).toHaveLength(1)
    expect(merged.activeProfileId).toBe(merged.profiles[0].id)
  })

  it('mergeCvtProfile rejects invalid optional measurements instead of inventing defaults', () => {
    const merged = mergeCvtProfile({
      id: 'test',
      actuationKind: 'electronic',
      belt: {
        outsideLengthMm: -1,
        cordOffsetFromOutsideMm: Number.NaN,
      } as never,
      geometry: {
        centerDistanceMm: 0,
        frontRadiusBoundsMm: { min: 80, max: 20 },
      } as never,
      finalReduction: {
        mode: 'stages',
        ratio: 999,
        stages: [{ driveTeeth: 13, drivenTeeth: 41 }, { driveTeeth: 0, drivenTeeth: 20 }],
      },
    })
    expect(merged.actuationKind).toBe('electronic')
    expect(merged.belt.outsideLengthMm).toBeNull()
    expect(merged.belt.cordOffsetFromOutsideMm).toBeNull()
    expect(merged.geometry.centerDistanceMm).toBeNull()
    expect(merged.geometry.frontRadiusBoundsMm).toBeNull()
    expect(merged.finalReduction.stages).toEqual([{ driveTeeth: 13, drivenTeeth: 41 }])
  })

  it('mergeCvtFormState rejects a v1-shaped (ratioLow/ratioHigh) payload and falls back to defaults', () => {
    const merged = mergeCvtFormState({ ratioLow: 2.4, ratioHigh: 0.9 } as never)
    expect(merged.wheelCircumferenceMm).toBe(Math.round(Math.PI * 496.8))
    expect(merged.notes.length).toBeGreaterThan(0)
  })
})

describe('applyImported (B19 — settings import overwrite)', () => {
  it('replaces kind/mt/cvt/inversionWheelCircumferenceMm in one shot and persists', async () => {
    const s = useDrivetrainStore()
    s.applyImported({
      kind: 'cvt',
      mt: mergeMtFormState({ redlineRpm: 11000 }),
      cvt: mergeCvtFormState(undefined),
      inversionWheelCircumferenceMm: 2001,
    })
    expect(s.kind).toBe('cvt')
    expect(s.mt.redlineRpm).toBe(11000)
    expect(s.inversionWheelCircumferenceMm).toBe(2001)

    await nextTick()
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).inversionWheelCircumferenceMm).toBe(2001)
  })
})
