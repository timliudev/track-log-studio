import {
  hpToKw,
  torqueNmFromPowerKw,
  type EnginePoint,
} from '@/domain/analysis/gearRecommendation'

/**
 * F8 — UI-facing parsing/validation glue for the engine-profile INPUT stage,
 * on top of `gearRecommendation.ts`'s math core (`createEngineCurveProfile`/
 * `createEngineTwoPointProfile`/`hpToKw`/`torqueNmFromPowerKw`, all reused
 * here — nothing in this file reimplements that module's unit-conversion or
 * validation math, it only turns free-form UI input — a pasted table, a
 * value-plus-unit pair — into the `EnginePoint[]`/Nm/kW shapes that module
 * already knows how to validate and consume).
 *
 * Deliberately pure (no Vue/Pinia) so parsing/diagnosis is unit-testable
 * without mounting a component, matching this codebase's convention of
 * keeping domain logic framework-free (see `drivetrain.ts`,
 * `gearRecommendation.ts` themselves).
 */

/** Which "horsepower"/power unit a peak-power or curve value column is
 *  entered in — mirrors `gearRecommendation.ts`'s `HorsepowerStandard` split
 *  (metric PS vs mechanical/imperial hp) but adds the two units riders
 *  actually see on spec sheets/dyno printouts, `kW` and `Nm`, so the picker
 *  covers every common case without asking the user to convert by hand. */
export type EnginePowerUnit = 'kW' | 'PS' | 'hp'

/** The curve-paste textarea's value COLUMN can be entered as raw torque
 *  (`Nm`) or as any of the three power units above — `torqueNm` per row is
 *  derived from whichever unit is selected (see {@link parseEngineCurveText}). */
export type EngineCurveValueUnit = 'Nm' | EnginePowerUnit

/** Convert one power-unit magnitude to kW, reusing {@link hpToKw} for the
 *  two horsepower flavours (`kW` itself is a straight pass-through — no
 *  conversion needed). Returns NaN for a non-finite/non-positive input,
 *  matching `gearRecommendation.ts`'s own NaN-on-invalid convention. */
export function powerValueToKw(value: number, unit: EnginePowerUnit): number {
  if (!Number.isFinite(value) || value <= 0) return NaN
  if (unit === 'kW') return value
  return hpToKw(value, unit === 'PS' ? 'metric' : 'mechanical')
}

/** Convert one (rpm, value) curve row to torque (Nm), given which unit the
 *  value column is in — `Nm` passes through unchanged; every power unit
 *  first converts to kW ({@link powerValueToKw}) then to Nm via
 *  {@link torqueNmFromPowerKw} (P = T*rpm/9549.3, inverted — see that
 *  function's doc in `gearRecommendation.ts`). Returns NaN for any
 *  non-finite/non-positive `rpm`/`value`, or when the unit conversion itself
 *  produces NaN. */
export function curveValueToTorqueNm(rpm: number, value: number, unit: EngineCurveValueUnit): number {
  if (!Number.isFinite(rpm) || rpm <= 0 || !Number.isFinite(value) || value <= 0) return NaN
  if (unit === 'Nm') return value
  const kw = powerValueToKw(value, unit)
  return torqueNmFromPowerKw(kw, rpm)
}

/** Result of {@link parseEngineCurveText}. */
export interface CurveParseResult {
  /** Successfully parsed (rpm, torqueNm) points, in the ORIGINAL line order
   *  (this module never sorts — same "trust the caller's order, validate
   *  don't silently fix" discipline as `createEngineCurveProfile`, see its
   *  doc in `gearRecommendation.ts`). Torque already converted to Nm per
   *  `unit`. */
  points: EnginePoint[]
  /** Count of non-blank lines that did NOT parse into a valid (rpm, value)
   *  pair — a header row (`rpm, torque(Nm)`, both cells non-numeric),
   *  a line with fewer than two fields, a non-finite/non-positive rpm or
   *  value, or a value column that failed to convert to a positive torque.
   *  Surfaced so the UI can tell the user "N 行被略過" rather than silently
   *  dropping malformed rows. Blank lines are ignored entirely (not counted
   *  as skipped — pasted tables routinely have trailing/blank lines). */
  skippedLines: number
}

/** Splits a pasted table row into fields on comma, tab, or run(s) of
 *  whitespace — covers copy-pasted spreadsheet cells (tab-separated),
 *  CSV-style comma rows, and hand-typed space-separated pairs alike. */
const FIELD_SPLIT_RE = /[,\t]+|\s+/

/**
 * Parse a pasted `(rpm, value)` table — one row per line, fields separated by
 * comma/tab/whitespace — into curve points with `value` converted to Nm per
 * `unit` (see {@link curveValueToTorqueNm}). Tolerates:
 *  - blank lines (ignored, not counted as skipped);
 *  - a header row (e.g. `rpm,torque(Nm)` — `Number('rpm')` is NaN, so a
 *    non-numeric first/second field naturally fails to parse and is skipped
 *    rather than special-cased);
 *  - extra whitespace around fields/lines.
 *
 * Does NOT sort, dedupe, or otherwise "fix" the row order — matching
 * `createEngineCurveProfile`'s "validates the caller's order, does not
 * impose one" policy (see its doc) — a strictly-increasing-rpm check happens
 * downstream, in {@link diagnoseCurveProfile}/`createEngineCurveProfile`
 * itself, not here.
 */
export function parseEngineCurveText(text: string, unit: EngineCurveValueUnit): CurveParseResult {
  const points: EnginePoint[] = []
  let skippedLines = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const fields = line.split(FIELD_SPLIT_RE).filter(Boolean)
    if (fields.length < 2) {
      skippedLines++
      continue
    }
    const rpm = Number(fields[0])
    const value = Number(fields[1])
    if (!Number.isFinite(rpm) || rpm <= 0 || !Number.isFinite(value) || value <= 0) {
      skippedLines++
      continue
    }
    const torqueNm = curveValueToTorqueNm(rpm, value, unit)
    if (!Number.isFinite(torqueNm) || torqueNm <= 0) {
      skippedLines++
      continue
    }
    points.push({ rpm, torqueNm })
  }
  return { points, skippedLines }
}

/** Why a parsed curve isn't (yet) a usable {@link
 *  import('./gearRecommendation').EngineCurveProfile} — mirrors
 *  `createEngineCurveProfile`'s validation exactly (see its doc in
 *  `gearRecommendation.ts`) so the UI can explain WHY construction would
 *  fail/failed, instead of just reporting a bare null. `null` means the
 *  curve is valid. */
export type CurveValidationReason = 'noRedline' | 'tooFewPoints' | 'notIncreasing'

/** Minimum points `createEngineCurveProfile` requires — kept in sync with
 *  that function's own `MIN_CURVE_POINTS` constant (not exported from
 *  `gearRecommendation.ts`, so restated here; a mismatch would only ever
 *  make this diagnostic MORE conservative than the real check, never less,
 *  since `createEngineCurveProfile` is the actual gate). */
const MIN_CURVE_POINTS = 3

/**
 * Diagnose why {@link points}/`redlineRpm` would fail (or did fail)
 * `createEngineCurveProfile`, for a human-readable inline explanation (e.g.
 * "需要至少 3 點" / "rpm 必須遞增") — see the F8 spec's explicit requirement
 * that a null return from the math core's constructor be explained, not just
 * silently swallowed. Returns `null` when the curve looks constructible
 * (mirrors, but does not replace, `createEngineCurveProfile`'s own checks —
 * always call that function too before trusting the result).
 */
export function diagnoseCurveProfile(points: readonly EnginePoint[], redlineRpm: number | null): CurveValidationReason | null {
  if (redlineRpm == null || !Number.isFinite(redlineRpm) || redlineRpm <= 0) return 'noRedline'
  if (points.length < MIN_CURVE_POINTS) return 'tooFewPoints'
  for (let i = 1; i < points.length; i++) {
    if (!(points[i].rpm > points[i - 1].rpm)) return 'notIncreasing'
  }
  return null
}
