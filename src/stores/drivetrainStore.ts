import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { tireSpecToCircumferenceMm, type GearRatioInput, type FinalDriveInput, type MtDrivetrainSpec } from '@/domain/analysis/drivetrain'

export type DrivetrainKind = 'mt' | 'cvt'
export type DrivetrainKindSelection = 'auto' | 'manual'

/** How a single gear ratio (or the final drive) is being entered — either
 *  form is always kept around in state (so switching the toggle doesn't
 *  discard what the user already typed into the other field), `mode` just
 *  picks which one is authoritative for the calculation (see
 *  `resolveGearRatio`/`resolveFinalDrive` in `drivetrain.ts`, which prefer
 *  `ratio` when set — so `toMtDrivetrainSpec` below only forwards the active
 *  mode's field(s) to avoid a stale ratio silently overriding fresh teeth). */
export type RatioInputMode = 'ratio' | 'teeth'

/** One gear's ratio input UI state — mirrors {@link GearRatioInput} in
 *  `drivetrain.ts` but keeps both the ratio and tooth-count fields (not just
 *  whichever is active) so toggling `mode` back and forth doesn't lose data. */
export interface MtGearFormInput {
  mode: RatioInputMode
  ratio: number
  drivenTeeth: number
  driveTeeth: number
}

/** Final drive input UI state — mirrors {@link MtGearFormInput}'s shape. */
export interface FinalDriveFormInput {
  mode: RatioInputMode
  ratio: number
  frontTeeth: number
  rearTeeth: number
}

/** How the rear wheel circumference is being entered. Since the tire-spec
 *  LIVE conversion (2026-07-08, see `setTireSpec`) this is always 'direct' in
 *  practice — the spec field auto-applies into the mm field instead of being
 *  a separate authoritative mode. 'tire' remains in the type so old persisted
 *  payloads still parse (they're migrated to 'direct' at store init) and so
 *  `toMtDrivetrainSpec`'s tire-resolution branch stays exercised/testable. */
export type CircumferenceInputMode = 'tire' | 'direct'

/** Manually-entered MT (chain-drive) spec inputs — mirrors {@link
 *  MtDrivetrainSpec} in `drivetrain.ts`, but kept as a separate UI-facing
 *  type so per-field inputs (e.g. a gear ratio being typed) don't have to be
 *  fully valid numbers at every keystroke. `gearRatios` length is the "gear
 *  count" — trimmed/extended by the panel's gear-count control. */
export interface MtFormState {
  /** Primary reduction ratio; 0/blank means "not set" (treated as 1:1 by the
   *  domain layer — see `computeMtGearTable`'s optional `primaryReduction`). */
  primaryReduction: number
  gearRatios: MtGearFormInput[]
  finalDrive: FinalDriveFormInput
  circumferenceMode: CircumferenceInputMode
  tireSpec: string
  wheelCircumferenceMm: number
  redlineRpm: number
}

/** One free-form note field: a label the user assigns (defaults cover the
 *  common CVT tuning params) and a value they fill in by hand. Neither side
 *  is computed — see `drivetrain.ts`'s header comment for why CVT tuning
 *  isn't modelled as a geometry calculator. */
export interface CvtNoteField {
  label: string
  value: string
}

export interface CvtFormState {
  /** Wheel circumference used for the CVT's own log-inversion view (kept
   *  separate from MT's so switching kind doesn't clobber either). */
  wheelCircumferenceMm: number
  /** #7/#12 — tire-spec string (e.g. "120/70-17") that LIVE-converts into
   *  `wheelCircumferenceMm`, same mechanism as MT's `tireSpec`/`setTireSpec`
   *  (see `setCvtTireSpec`). The wheel is the SAME physical tire regardless
   *  of drivetrain kind, so CVT riders need the same spec-to-mm converter MT
   *  has — CVT previously only exposed a bare mm number with no conversion
   *  helper. Kept as a separate field from MT's `tireSpec` (not shared) so
   *  switching `kind` doesn't clobber either bike's spec entry. */
  tireSpec: string
  /** Free-form tuning notes, e.g. 前普利尺寸/珠重/彈簧硬度/開閉盤規格/終傳比. */
  notes: CvtNoteField[]
}

function defaultMtGear(ratio: number): MtGearFormInput {
  return { mode: 'ratio', ratio, drivenTeeth: 0, driveTeeth: 0 }
}

const DEFAULT_MT: MtFormState = {
  primaryReduction: 2.833,
  gearRatios: [2.615, 1.812, 1.409, 1.16, 1.0, 0.885].map(defaultMtGear),
  finalDrive: { mode: 'teeth', ratio: 0, frontTeeth: 15, rearTeeth: 45 },
  circumferenceMode: 'direct',
  tireSpec: '120/70-17',
  // Matches the default tireSpec's own conversion (round(π * 599.8mm) — see
  // tireSpecToCircumferenceMm). The old arbitrary 1870 disagreed with the
  // spec sitting right next to it, which under live conversion (setTireSpec
  // compares against the PREVIOUS spec's resolution) would make retyping the
  // default spec into a fresh panel look like a dead control.
  wheelCircumferenceMm: 1884,
  redlineRpm: 10000,
}

/** Defaults for the CVT free-form note fields — labels are pre-filled from
 *  the user's own domain vocabulary; values start blank for the user to fill
 *  in per recorded run. */
function defaultCvtNotes(): CvtNoteField[] {
  return [
    { label: '前普利尺寸', value: '' },
    { label: '起始檔位位置', value: '' },
    { label: '最終檔位位置', value: '' },
    { label: '套管長度', value: '' },
    { label: '珠重', value: '' },
    { label: '珠溝形狀', value: '' },
    { label: '彈簧硬度', value: '' },
    { label: '開閉盤規格', value: '' },
    { label: '終傳比（三軸減速，如 13*41T）', value: '' },
    { label: '輪胎規格', value: '' },
  ]
}

const DEFAULT_CVT: CvtFormState = {
  wheelCircumferenceMm: Math.round(tireSpecToCircumferenceMm('120/80-12')),
  tireSpec: '120/80-12',
  notes: defaultCvtNotes(),
}

/** Turn one gear's UI form input into the domain layer's {@link GearRatioInput}
 *  — only the ACTIVE mode's field(s) are forwarded (not both), so a stale
 *  ratio left over from before the user switched to teeth-entry (or vice
 *  versa) can't silently win over `resolveGearRatio`'s "ratio wins if both
 *  are set" precedence. */
function toGearRatioInput(g: MtGearFormInput): GearRatioInput {
  return g.mode === 'teeth' ? { drivenTeeth: g.drivenTeeth, driveTeeth: g.driveTeeth } : { ratio: g.ratio }
}

/** Turn the final-drive UI form input into the domain layer's {@link
 *  FinalDriveInput} — same active-mode-only forwarding as {@link
 *  toGearRatioInput}. */
function toFinalDriveInput(f: FinalDriveFormInput): FinalDriveInput {
  return f.mode === 'teeth' ? { frontTeeth: f.frontTeeth, rearTeeth: f.rearTeeth } : { ratio: f.ratio }
}

/**
 * Turn the store's UI-facing {@link MtFormState} into the domain layer's
 * {@link MtDrivetrainSpec}, ready for `computeMtGearTable`/`mtGearSpeedLine`.
 * Resolves the wheel circumference from whichever mode is active (tire spec
 * string, parsed via `tireSpecToCircumferenceMm`, or the direct mm override)
 * — an invalid/unparsable tire spec resolves to NaN circumference, which
 * `computeMtGearTable` already treats as "invalid spec" (returns `[]`), so
 * the panel's existing precondition-hint path covers it without extra
 * plumbing here.
 */
export function toMtDrivetrainSpec(mt: MtFormState): MtDrivetrainSpec {
  const wheelCircumferenceMm =
    mt.circumferenceMode === 'tire' ? tireSpecToCircumferenceMm(mt.tireSpec) : mt.wheelCircumferenceMm
  return {
    primaryReduction: mt.primaryReduction > 0 ? mt.primaryReduction : undefined,
    gearRatios: mt.gearRatios.map(toGearRatioInput),
    finalDrive: toFinalDriveInput(mt.finalDrive),
    wheelCircumferenceMm,
    redlineRpm: mt.redlineRpm,
  }
}

// #7/#12 — was a hardcoded 6 (the common sportbike/scooter gearbox size);
// off-road/CUB (彎樑車) bikes often have FEWER gears (as low as 1-2 for some
// mini/pit bikes), and some other vehicles run more, so the ceiling is raised
// to 8 and the gear-count control (GearPanel's <select>, driven by this
// constant) lets the user pick anywhere in 1..MAX_GEARS — the default seed
// (DEFAULT_MT.gearRatios, 6 entries) is unchanged, only the ADJUSTABLE range
// widens. Persisted gearRatios arrays keep whatever length they already had
// on load (setGearCount only resizes on explicit user action — see below) —
// no forced backfill/truncation migration needed for this bump.
const MAX_GEARS = 8

// v1 -> v2: MT's gearRatios/finalDrive/circumference shape changed from
// plain numbers to either/or ratio-or-teeth objects (decisions #12/#13), and
// CVT dropped its geometry-calculator fields entirely in favour of free-form
// notes. Old (v1) data doesn't structurally match the new shape (e.g. v1's
// `mt.gearRatios` is `number[]`, v2's is `MtGearFormInput[]`), so rather than
// attempt a field-by-field migration that could silently misinterpret old
// numbers under new field names, v2 simply starts fresh from defaults when
// the persisted payload doesn't look like v2 shape — the old v1 key is left
// alone (not deleted) rather than overwritten, in case that's useful later.
const STORAGE_KEY = 'aracer-loga.drivetrain.v2'

export interface PersistedDrivetrain {
  kind: DrivetrainKind
  /** Whether future sessions may auto-select a page. Optional only for
   *  compatibility with v2 payloads written before this marker existed. */
  kindSelection?: DrivetrainKindSelection
  mt: MtFormState
  cvt: CvtFormState
  inversionWheelCircumferenceMm: number
}

/** True when `v` has at least the v2 shape's distinguishing fields (as
 *  opposed to v1's flat-number shape, or garbage). Deliberately loose — this
 *  is a "does this look sane enough to spread over defaults" check, not a
 *  full schema validation; any missing/extra fields are handled by the
 *  `{ ...DEFAULT, ...persisted }` merge in `loadPersisted`'s caller. */
function looksLikeV2Mt(v: unknown): v is Partial<MtFormState> {
  if (v == null || typeof v !== 'object') return false
  const m = v as Record<string, unknown>
  if (m.gearRatios != null && !Array.isArray(m.gearRatios)) return false
  if (Array.isArray(m.gearRatios) && m.gearRatios.length > 0) {
    const g0 = m.gearRatios[0]
    if (typeof g0 !== 'object' || g0 == null || Array.isArray(g0)) return false
  }
  if (m.finalDrive != null && (typeof m.finalDrive !== 'object' || Array.isArray(m.finalDrive))) return false
  return true
}

function looksLikeV2Cvt(v: unknown): v is Partial<CvtFormState> {
  if (v == null || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  if (c.notes != null && !Array.isArray(c.notes)) return false
  // v1 had numeric ratioLow/ratioHigh/finalReduction/maxRpm fields — if any of
  // those are present it's a v1 payload, not v2 (v2 has no such fields).
  if ('ratioLow' in c || 'ratioHigh' in c || 'finalReduction' in c || 'maxRpm' in c) return false
  return true
}

/**
 * Merge a possibly-partial/garbage MT payload (an older persisted blob, or an
 * imported settings JSON — see B19) over {@link DEFAULT_MT} — same per-array
 * defaulting the store's own init used to do inline, pulled out here so both
 * the store AND the settings export/import transfer module
 * (`domain/settings/settingsTransfer.ts`) share ONE merge implementation
 * rather than two copies that could drift.
 */
export function mergeMtFormState(partial: Partial<MtFormState> | null | undefined): MtFormState {
  const p = looksLikeV2Mt(partial) ? partial : undefined
  return {
    ...DEFAULT_MT,
    ...p,
    gearRatios: p?.gearRatios ? p.gearRatios.map((g) => ({ ...g })) : DEFAULT_MT.gearRatios.map((g) => ({ ...g })),
    finalDrive: { ...DEFAULT_MT.finalDrive, ...p?.finalDrive },
  }
}

/** CVT counterpart of {@link mergeMtFormState}. */
export function mergeCvtFormState(partial: Partial<CvtFormState> | null | undefined): CvtFormState {
  const p = looksLikeV2Cvt(partial) ? partial : undefined
  // Payloads written before CVT gained a tire default had no `tireSpec`.
  // Preserve their stored circumference and retain the old blank spec rather
  // than presenting the new default as if that user had configured it.
  const legacyWithoutTireSpec = p != null && !Object.prototype.hasOwnProperty.call(p, 'tireSpec')
  return {
    ...DEFAULT_CVT,
    ...p,
    ...(legacyWithoutTireSpec ? { tireSpec: '' } : {}),
    notes: p?.notes ? p.notes.map((n) => ({ ...n })) : defaultCvtNotes(),
  }
}

function loadPersisted(): Partial<PersistedDrivetrain> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw) as Partial<PersistedDrivetrain>
    return {
      kind: data.kind === 'mt' || data.kind === 'cvt' ? data.kind : undefined,
      kindSelection:
        data.kindSelection === 'auto' || data.kindSelection === 'manual' ? data.kindSelection : undefined,
      mt: looksLikeV2Mt(data.mt) ? data.mt : undefined,
      cvt: looksLikeV2Cvt(data.cvt) ? data.cvt : undefined,
      inversionWheelCircumferenceMm:
        typeof data.inversionWheelCircumferenceMm === 'number' ? data.inversionWheelCircumferenceMm : undefined,
    }
  } catch {
    return {}
  }
}

/**
 * A11 — 變速齒比計算器 (gear-ratio tool) UI state: which drivetrain kind is
 * active and the manually-entered spec for each. The spec is a VEHICLE
 * property (not track/circuit-specific), so it's persisted to localStorage
 * as a single global slot — same pattern as `settingsStore`/`suspensionStore`
 * — rather than a per-circuit or vehicle-profile system.
 */
export const useDrivetrainStore = defineStore('drivetrain', () => {
  const persisted = loadPersisted()
  const kind = ref<DrivetrainKind>(persisted.kind ?? 'mt')
  // An existing unmarked v2 payload already contains a remembered page and
  // is migrated as an explicit choice. Only a genuinely fresh profile, or a
  // payload already marked `auto`, may follow per-session inference.
  const kindSelection = ref<DrivetrainKindSelection>(
    persisted.kindSelection ?? (persisted.kind != null ? 'manual' : 'auto'),
  )
  const mt = ref<MtFormState>(mergeMtFormState(persisted.mt))
  const cvt = ref<CvtFormState>(mergeCvtFormState(persisted.cvt))
  // Tire-spec live conversion (user decision, 2026-07-08): the spec field now
  // converts + auto-applies into the circumference field AS YOU TYPE (see
  // `setTireSpec`), so the old tire/direct mode toggle is gone from the UI
  // and 'direct' is the only live mode. A payload persisted while 'tire'
  // mode was still active resolves its spec into the mm field once here —
  // the same math that mode applied on every recompute — so the effective
  // circumference stays identical (up to the whole-mm rounding the apply
  // flow always did). `circumferenceMode` stays in the persisted shape for
  // compatibility; it is simply always 'direct' from here on.
  if (mt.value.circumferenceMode === 'tire') {
    const circ = tireSpecToCircumferenceMm(mt.value.tireSpec)
    mt.value = {
      ...mt.value,
      circumferenceMode: 'direct',
      ...(Number.isFinite(circ) && circ > 0 ? { wheelCircumferenceMm: Math.round(circ) } : {}),
    }
  }
  // Wheel circumference used for LOG INVERSION (Layer 2) — separate from the
  // calculator spec's circumference above since a user may want to invert a
  // log without having filled in a full calculator spec (or vice versa).
  const inversionWheelCircumferenceMm = ref<number>(persisted.inversionWheelCircumferenceMm ?? 1870)

  watch(
    [kind, kindSelection, mt, cvt, inversionWheelCircumferenceMm],
    () => {
      const data: PersistedDrivetrain = {
        kind: kind.value,
        kindSelection: kindSelection.value,
        mt: mt.value,
        cvt: cvt.value,
        inversionWheelCircumferenceMm: inversionWheelCircumferenceMm.value,
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } catch {
        // storage unavailable / quota — settings simply won't persist
      }
    },
    { deep: true },
  )

  function setKind(k: DrivetrainKind): void {
    kind.value = k
    kindSelection.value = 'manual'
  }

  function applyDetectedKind(k: DrivetrainKind | null): boolean {
    if (kindSelection.value !== 'auto' || k == null) return false
    kind.value = k
    return true
  }

  function setMt(patch: Partial<Omit<MtFormState, 'gearRatios' | 'finalDrive'>>): void {
    mt.value = { ...mt.value, ...patch }
  }

  function setFinalDrive(patch: Partial<FinalDriveFormInput>): void {
    mt.value = { ...mt.value, finalDrive: { ...mt.value.finalDrive, ...patch } }
  }

  function setCvtWheelCircumferenceMm(mm: number): void {
    cvt.value = { ...cvt.value, wheelCircumferenceMm: mm }
  }

  function setCvtNote(index: number, patch: Partial<CvtNoteField>): void {
    if (index < 0 || index >= cvt.value.notes.length) return
    const next = [...cvt.value.notes]
    next[index] = { ...next[index], ...patch }
    cvt.value = { ...cvt.value, notes: next }
  }

  function addCvtNote(): void {
    cvt.value = { ...cvt.value, notes: [...cvt.value.notes, { label: '', value: '' }] }
  }

  function removeCvtNote(index: number): void {
    cvt.value = { ...cvt.value, notes: cvt.value.notes.filter((_, i) => i !== index) }
  }

  /** Patch a single gear's ratio-input fields by 1-based gear number. */
  function setGearRatio(gear: number, patch: Partial<MtGearFormInput>): void {
    if (gear < 1 || gear > MAX_GEARS) return
    const next = [...mt.value.gearRatios]
    while (next.length < gear) next.push(defaultMtGear(0))
    next[gear - 1] = { ...next[gear - 1], ...patch }
    mt.value = { ...mt.value, gearRatios: next }
  }

  /** Resize the gear count (1..MAX_GEARS), truncating or zero-padding. */
  function setGearCount(count: number): void {
    const n = Math.max(1, Math.min(MAX_GEARS, Math.round(count)))
    const next = mt.value.gearRatios.slice(0, n)
    while (next.length < n) next.push(defaultMtGear(0))
    mt.value = { ...mt.value, gearRatios: next }
  }

  function setInversionWheelCircumferenceMm(mm: number): void {
    inversionWheelCircumferenceMm.value = mm
  }

  /**
   * Tire-spec LIVE conversion (replaces the old "套用為周長" button flow):
   * store the new spec string and, when it constitutes an EFFECTIVE change,
   * auto-apply its resolved circumference (rounded to whole mm) into the
   * direct-entry field. Returns true when the circumference was applied (the
   * panel uses this for its visual feedback flash).
   *
   * "Effective change" rule (user decision, 2026-07-08): a spec edit
   * overwrites the circumference when it parses AND resolves to a DIFFERENT
   * whole-mm value than the previous spec did. Manual fine-tuning of the mm
   * field never touches the spec; a cosmetic spec edit that resolves to the
   * same geometry (`120/70-17` -> `120/70ZR17`, added whitespace, load-index
   * suffix...) doesn't stomp a manual tweak, but any real size change does —
   * the spec field is authoritative whenever it actually says something new.
   * A spec that stops parsing leaves the circumference alone (the mm field
   * keeps working standalone, same as before).
   */
  function setTireSpec(spec: string): boolean {
    const prevCirc = tireSpecToCircumferenceMm(mt.value.tireSpec)
    const nextCirc = tireSpecToCircumferenceMm(spec)
    const nextValid = Number.isFinite(nextCirc) && nextCirc > 0
    const prevValid = Number.isFinite(prevCirc) && prevCirc > 0
    const apply = nextValid && (!prevValid || Math.round(nextCirc) !== Math.round(prevCirc))
    mt.value = {
      ...mt.value,
      tireSpec: spec,
      ...(apply ? { wheelCircumferenceMm: Math.round(nextCirc), circumferenceMode: 'direct' as const } : {}),
    }
    return apply
  }

  /**
   * #7/#12 — CVT counterpart of `setTireSpec`: same "effective change"
   * auto-apply rule (a spec edit that resolves to a different whole-mm value
   * overwrites `cvt.wheelCircumferenceMm`; a cosmetic edit or a still-typing/
   * unparsable spec doesn't touch it), just against the CVT form's own
   * `tireSpec`/`wheelCircumferenceMm` fields instead of MT's. CVT has no
   * `circumferenceMode` (that field only exists for MT's now-vestigial
   * tire/direct toggle — see `CircumferenceInputMode`'s doc) since CVT's mm
   * field was always "direct" to begin with; the spec here is purely a
   * convenience converter feeding the same one field, not a second mode.
   */
  function setCvtTireSpec(spec: string): boolean {
    const prevCirc = tireSpecToCircumferenceMm(cvt.value.tireSpec)
    const nextCirc = tireSpecToCircumferenceMm(spec)
    const nextValid = Number.isFinite(nextCirc) && nextCirc > 0
    const prevValid = Number.isFinite(prevCirc) && prevCirc > 0
    const apply = nextValid && (!prevValid || Math.round(nextCirc) !== Math.round(prevCirc))
    cvt.value = {
      ...cvt.value,
      tireSpec: spec,
      ...(apply ? { wheelCircumferenceMm: Math.round(nextCirc) } : {}),
    }
    return apply
  }

  /**
   * B19 — replace kind/mt/cvt/inversionWheelCircumferenceMm all at once from
   * an imported settings bundle (`domain/settings/settingsTransfer.ts` has
   * already sanitized `next.mt`/`next.cvt` via `mergeMtFormState`/
   * `mergeCvtFormState`, so this is a plain overwrite — the same shape the
   * store already persists). One assignment per field so the persistence
   * `watch` below fires (and writes localStorage) exactly once.
   */
  function applyImported(next: PersistedDrivetrain): void {
    kind.value = next.kind
    kindSelection.value = next.kindSelection ?? 'manual'
    mt.value = next.mt
    cvt.value = next.cvt
    inversionWheelCircumferenceMm.value = next.inversionWheelCircumferenceMm
  }

  return {
    kind,
    kindSelection,
    mt,
    cvt,
    inversionWheelCircumferenceMm,
    setKind,
    applyDetectedKind,
    setMt,
    setFinalDrive,
    setCvtWheelCircumferenceMm,
    setCvtTireSpec,
    setCvtNote,
    addCvtNote,
    removeCvtNote,
    setGearRatio,
    setGearCount,
    setInversionWheelCircumferenceMm,
    setTireSpec,
    applyImported,
  }
})

export { MAX_GEARS }
