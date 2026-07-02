import { defineStore } from 'pinia'
import { ref } from 'vue'

export type DrivetrainKind = 'mt' | 'cvt'

/** Manually-entered MT (chain-drive) spec inputs — mirrors {@link MtDrivetrainSpec}
 *  in `drivetrain.ts`, but kept as a separate UI-facing type so per-field
 *  inputs (e.g. a gear ratio being typed) don't have to be fully valid
 *  numbers at every keystroke (see GearPanel's parsing of blank/partial
 *  fields). `gearRatios` length is the "gear count" — trimmed/extended by
 *  the panel's gear-count control. */
export interface MtFormState {
  primaryReduction: number
  gearRatios: number[]
  frontSprocketTeeth: number
  rearSprocketTeeth: number
  wheelCircumferenceMm: number
  redlineRpm: number
}

export interface CvtFormState {
  ratioLow: number
  ratioHigh: number
  finalReduction: number
  wheelCircumferenceMm: number
  maxRpm: number
}

const DEFAULT_MT: MtFormState = {
  primaryReduction: 2.833,
  gearRatios: [2.615, 1.812, 1.409, 1.16, 1.0, 0.885],
  frontSprocketTeeth: 15,
  rearSprocketTeeth: 45,
  wheelCircumferenceMm: 1870,
  redlineRpm: 10000,
}

const DEFAULT_CVT: CvtFormState = {
  ratioLow: 2.4,
  ratioHigh: 0.9,
  finalReduction: 8,
  wheelCircumferenceMm: 1400,
  maxRpm: 8000,
}

const MAX_GEARS = 6

/**
 * A11 — 變速齒比計算器 (gear-ratio tool) UI state: which drivetrain kind is
 * active and the manually-entered spec for each. Transient (in-memory only,
 * like `sectorStore`/`analyzerStore`'s toggles) — no persistence yet; a
 * natural follow-up once `useCircuitPersistence`-style local storage is
 * extended to non-track settings (see AnalyzerView's D "local persistence"
 * queue item in project memory).
 */
export const useDrivetrainStore = defineStore('drivetrain', () => {
  const kind = ref<DrivetrainKind>('mt')
  const mt = ref<MtFormState>({ ...DEFAULT_MT, gearRatios: [...DEFAULT_MT.gearRatios] })
  const cvt = ref<CvtFormState>({ ...DEFAULT_CVT })
  // Wheel circumference used for LOG INVERSION (Layer 2) — separate from the
  // calculator spec's circumference above since a user may want to invert a
  // log without having filled in a full calculator spec (or vice versa).
  const inversionWheelCircumferenceMm = ref<number>(1870)

  function setKind(k: DrivetrainKind): void {
    kind.value = k
  }

  function setMt(patch: Partial<MtFormState>): void {
    mt.value = { ...mt.value, ...patch }
  }

  function setCvt(patch: Partial<CvtFormState>): void {
    cvt.value = { ...cvt.value, ...patch }
  }

  /** Set a single gear's ratio by 1-based gear number (extends the array with
   *  zeros if needed, clamped to MAX_GEARS). */
  function setGearRatio(gear: number, value: number): void {
    if (gear < 1 || gear > MAX_GEARS) return
    const next = [...mt.value.gearRatios]
    while (next.length < gear) next.push(0)
    next[gear - 1] = value
    mt.value = { ...mt.value, gearRatios: next }
  }

  /** Resize the gear count (1..MAX_GEARS), truncating or zero-padding. */
  function setGearCount(count: number): void {
    const n = Math.max(1, Math.min(MAX_GEARS, Math.round(count)))
    const next = mt.value.gearRatios.slice(0, n)
    while (next.length < n) next.push(0)
    mt.value = { ...mt.value, gearRatios: next }
  }

  function setInversionWheelCircumferenceMm(mm: number): void {
    inversionWheelCircumferenceMm.value = mm
  }

  return {
    kind,
    mt,
    cvt,
    inversionWheelCircumferenceMm,
    setKind,
    setMt,
    setCvt,
    setGearRatio,
    setGearCount,
    setInversionWheelCircumferenceMm,
  }
})

export { MAX_GEARS }
