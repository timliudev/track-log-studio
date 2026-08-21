import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  useDrivetrainStore,
  mergeMtFormState,
  sanitizeEngineProfileFormState,
  type EngineProfileFormState,
} from '@/stores/drivetrainStore'

/**
 * F8 — engine-profile persistence sanitizer, same "reject the entry, don't
 * throw" discipline M9 P2 established for the CVT array sanitizers (see
 * `drivetrainStore.ts`'s header comments on `positiveNumberOrNull`/
 * `MAX_CVT_ARRAY_LENGTH`). These tests target malformed/hostile persisted
 * payloads specifically — well-formed round-tripping is already covered by
 * the broader `drivetrainStore.test.ts` suite.
 */

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

describe('sanitizeEngineProfileFormState — well-formed input', () => {
  it('returns a default profile for undefined/null', () => {
    const merged = sanitizeEngineProfileFormState(undefined)
    expect(merged.activeKind).toBe('twoPoint')
    expect(merged.twoPoint).toEqual({
      peakTorqueRpm: null,
      peakPowerRpm: null,
      peakTorqueNm: null,
      peakPowerValue: null,
      peakPowerUnit: 'kW',
    })
    expect(merged.curve).toEqual({ rawText: '', valueUnit: 'Nm' })
  })

  it('accepts a well-shaped two-point payload', () => {
    const merged = sanitizeEngineProfileFormState({
      activeKind: 'twoPoint',
      twoPoint: {
        peakTorqueRpm: 6500,
        peakPowerRpm: 9000,
        peakTorqueNm: 42,
        peakPowerValue: 55,
        peakPowerUnit: 'PS',
      },
      curve: { rawText: '', valueUnit: 'Nm' },
    })
    expect(merged.activeKind).toBe('twoPoint')
    expect(merged.twoPoint).toEqual({
      peakTorqueRpm: 6500,
      peakPowerRpm: 9000,
      peakTorqueNm: 42,
      peakPowerValue: 55,
      peakPowerUnit: 'PS',
    })
  })

  it('accepts a well-shaped curve payload', () => {
    const merged = sanitizeEngineProfileFormState({
      activeKind: 'curve',
      curve: { rawText: '3000,40\n6000,55', valueUnit: 'kW' },
    })
    expect(merged.activeKind).toBe('curve')
    expect(merged.curve).toEqual({ rawText: '3000,40\n6000,55', valueUnit: 'kW' })
  })
})

describe('sanitizeEngineProfileFormState — malformed/hostile input', () => {
  it('does not throw on completely garbage input', () => {
    expect(() => sanitizeEngineProfileFormState('not an object' as never)).not.toThrow()
    expect(() => sanitizeEngineProfileFormState(42 as never)).not.toThrow()
    expect(() => sanitizeEngineProfileFormState([1, 2, 3] as never)).not.toThrow()
    expect(() => sanitizeEngineProfileFormState(null)).not.toThrow()
  })

  it('falls back to twoPoint for an unrecognised activeKind', () => {
    const merged = sanitizeEngineProfileFormState({ activeKind: 'evil' } as never)
    expect(merged.activeKind).toBe('twoPoint')
  })

  it('drops non-finite/negative/zero numeric fields to null rather than throwing', () => {
    const merged = sanitizeEngineProfileFormState({
      twoPoint: {
        peakTorqueRpm: Number.NaN,
        peakPowerRpm: -100,
        peakTorqueNm: 0,
        peakPowerValue: Infinity,
        peakPowerUnit: 'kW',
      },
    } as never)
    expect(merged.twoPoint.peakTorqueRpm).toBeNull()
    expect(merged.twoPoint.peakPowerRpm).toBeNull()
    expect(merged.twoPoint.peakTorqueNm).toBeNull()
    expect(merged.twoPoint.peakPowerValue).toBeNull()
  })

  it('clamps out-of-physical-range numeric fields to null (not silently kept)', () => {
    const merged = sanitizeEngineProfileFormState({
      twoPoint: {
        peakTorqueRpm: 1e9, // way beyond MAX_RPM
        peakPowerRpm: 8000,
        peakTorqueNm: 1e9, // way beyond MAX_TORQUE_NM
        peakPowerValue: 1e9, // way beyond MAX_ENGINE_POWER_VALUE
        peakPowerUnit: 'kW',
      },
    } as never)
    expect(merged.twoPoint.peakTorqueRpm).toBeNull()
    expect(merged.twoPoint.peakPowerRpm).toBe(8000)
    expect(merged.twoPoint.peakTorqueNm).toBeNull()
    expect(merged.twoPoint.peakPowerValue).toBeNull()
  })

  it('falls back to a default power unit for an unrecognised enum value', () => {
    const merged = sanitizeEngineProfileFormState({
      twoPoint: { peakPowerUnit: 'nonsense-unit' },
    } as never)
    expect(merged.twoPoint.peakPowerUnit).toBe('kW')
  })

  it('falls back to a default curve value unit for an unrecognised enum value', () => {
    const merged = sanitizeEngineProfileFormState({
      curve: { valueUnit: '<script>alert(1)</script>' },
    } as never)
    expect(merged.curve.valueUnit).toBe('Nm')
  })

  it('coerces a non-string rawText to the fallback instead of throwing', () => {
    const merged = sanitizeEngineProfileFormState({ curve: { rawText: 12345 } } as never)
    expect(merged.curve.rawText).toBe('')
  })

  it('truncates a pathologically long pasted curve rather than keeping it whole', () => {
    const huge = '1,1\n'.repeat(50_000) // ~200k chars
    const merged = sanitizeEngineProfileFormState({ curve: { rawText: huge, valueUnit: 'Nm' } } as never)
    expect(merged.curve.rawText.length).toBeLessThan(huge.length)
    expect(merged.curve.rawText.length).toBeLessThanOrEqual(100_000)
  })

  it('ignores a prototype-pollution-shaped payload without throwing or polluting', () => {
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "twoPoint": {"peakTorqueRpm": 6000}}') as Partial<EngineProfileFormState>
    expect(() => sanitizeEngineProfileFormState(hostile)).not.toThrow()
    const merged = sanitizeEngineProfileFormState(hostile)
    expect(merged.twoPoint.peakTorqueRpm).toBe(6000)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('does not leak a shared object reference between two sanitize calls', () => {
    const a = sanitizeEngineProfileFormState(undefined)
    const b = sanitizeEngineProfileFormState(undefined)
    a.twoPoint.peakTorqueRpm = 9999
    expect(b.twoPoint.peakTorqueRpm).toBeNull()
  })
})

describe('mergeMtFormState — engineProfile field integration', () => {
  it('backfills a default engineProfile for a pre-F8 payload that lacks the field entirely', () => {
    const merged = mergeMtFormState({ redlineRpm: 11000 } as never)
    expect(merged.engineProfile.activeKind).toBe('twoPoint')
    expect(merged.engineProfile.twoPoint.peakTorqueRpm).toBeNull()
  })

  it('sanitizes a malformed engineProfile nested in an otherwise well-shaped MT payload', () => {
    const merged = mergeMtFormState({
      redlineRpm: 11000,
      engineProfile: { activeKind: 'curve', twoPoint: 'garbage', curve: { rawText: 999 } },
    } as never)
    expect(merged.redlineRpm).toBe(11000)
    expect(merged.engineProfile.activeKind).toBe('curve')
    expect(merged.engineProfile.twoPoint.peakTorqueRpm).toBeNull()
    expect(merged.engineProfile.curve.rawText).toBe('')
  })
})

describe('drivetrainStore — engine-profile actions', () => {
  it('setEngineProfileActiveKind switches the active kind without touching the other form', () => {
    const s = useDrivetrainStore()
    s.setEngineTwoPoint({ peakTorqueRpm: 6500 })
    s.setEngineProfileActiveKind('curve')
    expect(s.mt.engineProfile.activeKind).toBe('curve')
    expect(s.mt.engineProfile.twoPoint.peakTorqueRpm).toBe(6500)
  })

  it('setEngineTwoPoint patches only the given fields', () => {
    const s = useDrivetrainStore()
    s.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    s.setEngineTwoPoint({ peakTorqueNm: 42 })
    expect(s.mt.engineProfile.twoPoint).toEqual({
      peakTorqueRpm: 6500,
      peakPowerRpm: 9000,
      peakTorqueNm: 42,
      peakPowerValue: null,
      peakPowerUnit: 'kW',
    })
  })

  it('setEngineCurve patches only the given fields', () => {
    const s = useDrivetrainStore()
    s.setEngineCurve({ rawText: '3000,40\n6000,55' })
    s.setEngineCurve({ valueUnit: 'kW' })
    expect(s.mt.engineProfile.curve).toEqual({ rawText: '3000,40\n6000,55', valueUnit: 'kW' })
  })
})
