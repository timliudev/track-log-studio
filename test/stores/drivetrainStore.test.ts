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
  toCvtForceBalanceInput,
  toCvtTraceConfig,
  usesCvtCalibrationFixedReduction,
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
    expect(s.activeCvtProfile.force.roller.track).toEqual([])
    expect(s.activeCvtProfile.force.spring.mode).toBe('disabled')
    expect(s.activeCvtProfile.force.couplingMode).toBe('disabled')
    expect(s.activeCvtProfile.calibration.combinedFixedReduction).toBeNull()
    expect(s.activeCvtProfile.calibration.upshiftMap).toEqual([])
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

  it('persists measured force parameters without converting a catalog rpm label', async () => {
    const s1 = useDrivetrainStore()
    s1.updateCvtProfile(s1.activeCvtProfile.id, {
      force: {
        roller: {
          massesG: [9, 9, 9, 9, 9, 9],
          track: [{ travelMm: 0, radiusMm: 24 }, { travelMm: 12, radiusMm: 36 }],
          efficiency: 1,
        },
        spring: {
          catalogLabel: '1500 rpm',
          mode: 'linear',
          rateNPerMm: 11,
          installedPreloadMm: 8,
        },
        torqueCam: {
          mode: 'profile',
          points: [
            { travelMm: 0, angleDeg: 42, effectiveRadiusMm: 38 },
            { travelMm: 10, angleDeg: 45, effectiveRadiusMm: 38 },
          ],
          torqueShare: 0.5,
          equalSplitAssumption: true,
        },
        couplingMode: 'ideal',
        operatingFrontRpm: 7500,
        operatingRearTorqueNm: 20,
      },
    })
    await nextTick()
    setActivePinia(createPinia())
    const force = useDrivetrainStore().activeCvtProfile.force
    expect(force.roller.massesG).toHaveLength(6)
    expect(force.spring.catalogLabel).toBe('1500 rpm')
    expect(force.spring.rateNPerMm).toBe(11)
    expect(force.torqueCam.equalSplitAssumption).toBe(true)
    expect(force.couplingMode).toBe('ideal')
  })

  it('retains directional maps but clears hold-out status when a physical input changes', () => {
    const s = useDrivetrainStore()
    s.updateCvtProfile(s.activeCvtProfile.id, {
      calibration: {
        accuracyTargetRpm: 100,
        holdoutResidualRpm: 80,
        upshiftMap: [{ ratio: 1.2, scale: 1.01 }],
      },
    })
    s.updateCvtProfile(s.activeCvtProfile.id, { belt: { widthMm: 22 } })
    expect(s.activeCvtProfile.calibration.upshiftMap).toEqual([{ ratio: 1.2, scale: 1.01 }])
    expect(s.activeCvtProfile.calibration.holdoutResidualRpm).toBeNull()
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

describe('toCvtForceBalanceInput', () => {
  it('does not fill missing force measurements and converts axial cam angles explicitly', () => {
    const s = useDrivetrainStore()
    s.updateCvtProfile(s.activeCvtProfile.id, {
      force: {
        torqueCam: {
          mode: 'profile',
          angleBasis: 'axial',
          points: [
            { travelMm: 0, angleDeg: 30, effectiveRadiusMm: 40 },
            { travelMm: 10, angleDeg: 35, effectiveRadiusMm: 40 },
          ],
        },
      },
    })
    const input = toCvtForceBalanceInput(s.activeCvtProfile)
    expect(input.frontRpm).toBeNaN()
    expect(input.roller?.efficiency).toBeNull()
    expect(input.spring).toBeNull()
    expect(input.coupling.mode).toBe('disabled')
    expect(input.torqueCam?.points[0].angleDeg).toBe(60)
  })

  it('derives linear spring preload only from measured free and installed lengths', () => {
    const s = useDrivetrainStore()
    s.updateCvtProfile(s.activeCvtProfile.id, {
      force: { spring: { mode: 'linear', rateNPerMm: 10, freeLengthMm: 120, installedLengthMm: 105 } },
    })
    expect(toCvtForceBalanceInput(s.activeCvtProfile).spring).toEqual({
      mode: 'linear', rateNPerMm: 10, installedPreloadMm: 15,
    })
  })

  it('uses separate upshift/downshift calibration maps', () => {
    const s = useDrivetrainStore()
    s.updateCvtProfile(s.activeCvtProfile.id, {
      calibration: {
        activeDirection: 'downshift',
        upshiftMap: [{ ratio: 1, scale: 0.9 }],
        downshiftMap: [{ ratio: 1, scale: 1.1 }],
      },
    })
    expect(toCvtForceBalanceInput(s.activeCvtProfile).coupling.calibrationMap).toEqual([{ ratio: 1, scale: 1.1 }])
  })
})

describe('CVT fixed-reduction calibration fallback', () => {
  it('is used only while the explicit gear/final pair is incomplete', () => {
    const s = useDrivetrainStore()
    s.updateCvtProfile(s.activeCvtProfile.id, { calibration: { combinedFixedReduction: 12.5 } })
    expect(usesCvtCalibrationFixedReduction(s.activeCvtProfile)).toBe(true)
    expect(toCvtTraceConfig(s.activeCvtProfile).gearReduction).toBe(12.5)
    expect(toCvtTraceConfig(s.activeCvtProfile).finalReduction).toBe(1)
    s.updateCvtProfile(s.activeCvtProfile.id, {
      gearReduction: { mode: 'ratio', ratio: 2 },
      finalReduction: { mode: 'ratio', ratio: 6 },
    })
    expect(usesCvtCalibrationFixedReduction(s.activeCvtProfile)).toBe(false)
    expect(toCvtTraceConfig(s.activeCvtProfile).gearReduction).toBe(2)
    expect(toCvtTraceConfig(s.activeCvtProfile).finalReduction).toBe(6)
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
        stages: [{ driveTeeth: 13, drivenTeeth: 41 }, { driveTeeth: -5, drivenTeeth: 20 }],
      },
    })
    expect(merged.actuationKind).toBe('electronic')
    expect(merged.belt.outsideLengthMm).toBeNull()
    expect(merged.belt.cordOffsetFromOutsideMm).toBeNull()
    expect(merged.geometry.centerDistanceMm).toBeNull()
    expect(merged.geometry.frontRadiusBoundsMm).toBeNull()
    expect(merged.finalReduction.stages).toEqual([{ driveTeeth: 13, drivenTeeth: 41 }])
  })

  it('mergeCvtProfile keeps a blank (driveTeeth/drivenTeeth: 0) stage instead of discarding it (B96)', () => {
    // Regression for the "新增一軸" (add stage) button appearing to do
    // nothing: CvtReductionEditor.addStage() emits a placeholder
    // `{ driveTeeth: 0, drivenTeeth: 0 }` row for the user to fill in, and the
    // sanitizer must not silently delete that row before it can be edited.
    const merged = mergeCvtProfile({
      id: 'test',
      gearReduction: {
        mode: 'stages',
        ratio: 0,
        stages: [{ driveTeeth: 13, drivenTeeth: 41 }, { driveTeeth: 0, drivenTeeth: 0 }],
      },
    })
    expect(merged.gearReduction.stages).toEqual([
      { driveTeeth: 13, drivenTeeth: 41 },
      { driveTeeth: 0, drivenTeeth: 0 },
    ])
  })

  it('updateCvtProfile grows the stage array by one when appending a blank stage like addStage() does (B96)', () => {
    const s = useDrivetrainStore()
    const profileId = s.activeCvtProfile.id
    s.updateCvtProfile(profileId, {
      gearReduction: {
        mode: 'stages',
        stages: [{ driveTeeth: 13, drivenTeeth: 41 }],
      },
    })
    expect(s.activeCvtProfile.gearReduction.stages).toHaveLength(1)

    // Mimic CvtReductionEditor.addStage(): append a blank placeholder stage.
    s.updateCvtProfile(profileId, {
      gearReduction: {
        mode: 'stages',
        stages: [...s.activeCvtProfile.gearReduction.stages, { driveTeeth: 0, drivenTeeth: 0 }],
      },
    })
    expect(s.activeCvtProfile.gearReduction.stages).toHaveLength(2)
    expect(s.activeCvtProfile.gearReduction.stages[1]).toEqual({ driveTeeth: 0, drivenTeeth: 0 })
  })

  it('mergeCvtProfile still rejects out-of-range or non-finite teeth counts (M9 P2 not regressed)', () => {
    const merged = mergeCvtProfile({
      id: 'test',
      gearReduction: {
        mode: 'stages',
        ratio: 0,
        stages: [
          { driveTeeth: 13, drivenTeeth: 41 },
          { driveTeeth: -5, drivenTeeth: 20 },
          { driveTeeth: Number.POSITIVE_INFINITY, drivenTeeth: 20 },
          { driveTeeth: Number.NaN, drivenTeeth: 20 },
          { driveTeeth: 100000, drivenTeeth: 20 },
        ],
      },
    })
    expect(merged.gearReduction.stages).toEqual([{ driveTeeth: 13, drivenTeeth: 41 }])
  })

  it('mergeCvtProfile truncates oversized measurement arrays instead of keeping them unbounded (M9 P2)', () => {
    const oversizedMasses = Array.from({ length: 10000 }, () => 10)
    const oversizedTrack = Array.from({ length: 10000 }, () => ({ travelMm: 10, radiusMm: 10 }))
    const oversizedForceCurve = Array.from({ length: 10000 }, () => ({ travelMm: 10, value: 1 }))
    const oversizedCamPoints = Array.from({ length: 10000 }, () => ({ travelMm: 10, angleDeg: 10, effectiveRadiusMm: 10 }))
    const oversizedCalibrationMap = Array.from({ length: 10000 }, () => ({ ratio: 1, scale: 1 }))
    const oversizedStages = Array.from({ length: 10000 }, () => ({ driveTeeth: 13, drivenTeeth: 41 }))

    const merged = mergeCvtProfile({
      id: 'test',
      gearReduction: { mode: 'stages', ratio: 0, stages: oversizedStages },
      force: {
        roller: { kind: 'roller', massesG: oversizedMasses, track: oversizedTrack, efficiency: null },
        spring: {
          catalogLabel: '',
          mode: 'curve',
          freeLengthMm: null,
          installedLengthMm: null,
          coilBindLengthMm: null,
          rateNPerMm: null,
          installedPreloadMm: null,
          forceCurve: oversizedForceCurve,
        },
        torqueCam: {
          mode: 'profile',
          angleBasis: 'circumferential',
          points: oversizedCamPoints,
          torqueShare: null,
          equalSplitAssumption: false,
          torsionTorqueNm: null,
        },
      } as never,
      calibration: {
        upshiftMap: oversizedCalibrationMap,
        downshiftMap: oversizedCalibrationMap,
      } as never,
    })

    expect(merged.gearReduction.stages.length).toBe(4096)
    expect(merged.force.roller.massesG.length).toBe(4096)
    expect(merged.force.roller.track.length).toBe(4096)
    expect(merged.force.spring.forceCurve.length).toBe(4096)
    expect(merged.force.torqueCam.points.length).toBe(4096)
    expect(merged.calibration.upshiftMap.length).toBe(4096)
    expect(merged.calibration.downshiftMap.length).toBe(4096)
  })

  it('mergeCvtProfile rejects physically-implausible out-of-range measurements (M9 P2)', () => {
    const merged = mergeCvtProfile({
      id: 'test',
      wheelCircumferenceMm: 1e9,
      gearReduction: { mode: 'ratio', ratio: 1e6, stages: [] },
      belt: {
        outsideLengthMm: 1e9,
        wedgeAngle: { valueDeg: 500, basis: 'half' },
      } as never,
      geometry: {
        centerDistanceMm: 1e9,
        frontSheaveAngle: { valueDeg: 179, basis: 'included' },
        frontRadiusBoundsMm: { min: 1e9, max: 1e9 + 1 },
      } as never,
      force: {
        roller: { kind: 'roller', massesG: [1e9], track: [], efficiency: null },
        operatingFrontRpm: 1e9,
        frictionCoefficientMin: 1e9,
      } as never,
    })
    expect(merged.wheelCircumferenceMm).not.toBe(1e9)
    expect(merged.gearReduction.ratio).toBe(0)
    expect(merged.belt.outsideLengthMm).toBeNull()
    expect(merged.belt.wedgeAngle.valueDeg).toBeNull()
    expect(merged.geometry.centerDistanceMm).toBeNull()
    expect(merged.geometry.frontSheaveAngle.valueDeg).toBeNull()
    expect(merged.geometry.frontRadiusBoundsMm).toBeNull()
    expect(merged.force.roller.massesG).toEqual([])
    expect(merged.force.operatingFrontRpm).toBeNull()
    expect(merged.force.frictionCoefficientMin).toBeNull()
  })

  it('mergeCvtProfile accepts realistic in-range measurements unchanged (M9 P2)', () => {
    const merged = mergeCvtProfile({
      id: 'test',
      wheelCircumferenceMm: 1560,
      belt: { wedgeAngle: { valueDeg: 15, basis: 'half' } } as never,
      geometry: { frontSheaveAngle: { valueDeg: 26, basis: 'included' } } as never,
      force: { operatingFrontRpm: 7500, frictionCoefficientMin: 0.4 } as never,
    })
    expect(merged.wheelCircumferenceMm).toBe(1560)
    expect(merged.belt.wedgeAngle.valueDeg).toBe(15)
    expect(merged.geometry.frontSheaveAngle.valueDeg).toBe(26)
    expect(merged.force.operatingFrontRpm).toBe(7500)
    expect(merged.force.frictionCoefficientMin).toBe(0.4)
  })

  it('updateCvtProfile keeps a partially-filled radius-bounds pair instead of wiping it out (B97)', () => {
    // Regression for "節圓半徑4個欄位輸入後焦點離開值會消失": each <input>
    // fires @change (blur) independently and CvtProfileEditor.patchBounds
    // always re-sends the *whole* {min, max} pair, defaulting whichever
    // field hasn't been touched yet to 0 (patchBounds' own "current ??
    // {min:0, max:0}" fallback). The sanitizer must not treat that blank
    // sibling as invalid and collapse the entire object to null the moment
    // the user's just-typed value round-trips through the store.
    const s = useDrivetrainStore()
    const profileId = s.activeCvtProfile.id

    // User types "20" into the "min" field first, then blurs — "max" is
    // still the untouched-field default of 0.
    s.updateCvtProfile(profileId, { geometry: { frontRadiusBoundsMm: { min: 20, max: 0 } } })
    const afterMin = s.activeCvtProfile.geometry.frontRadiusBoundsMm
    expect(afterMin).not.toBeNull()
    expect(afterMin?.min).toBe(20)
    expect(Number.isNaN(afterMin?.max)).toBe(true)

    // User now fills in "max" — patchBounds spreads the previous (now
    // non-null) bounds object, so this arrives as a complete, valid pair.
    s.updateCvtProfile(profileId, { geometry: { frontRadiusBoundsMm: { min: 20, max: 45 } } })
    expect(s.activeCvtProfile.geometry.frontRadiusBoundsMm).toEqual({ min: 20, max: 45 })
  })

  it('mergeCvtProfile rejects a genuinely-invalid radius-bounds edge instead of keeping the other value (B97 not regressed)', () => {
    // A negative min isn't the "blank" 0 sentinel — it's actual garbage, so
    // the M9 P2 rule (reject the whole pair) still applies; the valid `max`
    // must NOT be kept on its own.
    const merged = mergeCvtProfile({
      id: 'test',
      geometry: { frontRadiusBoundsMm: { min: -5, max: 40 } },
    } as never)
    expect(merged.geometry.frontRadiusBoundsMm).toBeNull()
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
