/**
 * Channel-name evidence for the digital/analog classification (B127).
 *
 * THIS IS A HEURISTIC. Its guiding principle is: **never wrongly demote a
 * flag.** Value range alone (`looksDigital` in `VboExporter.ts`: every finite
 * sample is 0 or 1, no source unit) cannot tell a real boolean flag that never
 * fired in this recording (`Malf8.Malf_On`, `Pit_SW_On`) from an analog
 * quantity that merely sat at a constant 0/1 for the whole session
 * (`IR_LapNumber`, `IR_LapTime`, `SimRPM`, `MapNum`). The channel NAME is the
 * only extra evidence available, so it is consulted — but only in the one
 * situation where value range is genuinely ambiguous (a constant channel), and
 * only to demote when the name POSITIVELY says "this is a quantity" and gives
 * no sign of being a flag. Anything ambiguous keeps today's behaviour (stay
 * digital): a missed demotion equals the pre-B127 status quo, a wrongful
 * demotion is a new regression, so the rule is deliberately biased to miss.
 *
 * The rule ("V4" in the B127 experiment): a channel that already passed the
 * value-range test is demoted to analog ONLY IF all three hold —
 *   1. it is constant for the whole session,
 *   2. its name matches {@link NUMERIC_NAME},
 *   3. its name does NOT match {@link BOOL_NAME}
 * (the boolean allowlist overrides the numeric denylist, so e.g.
 * `Fuel8.RPM_Limit` — matches both `rpm` and `_limit` — stays digital).
 *
 * Measured evidence (2026-08-21 experiment `experiment/b127-candidates`,
 * 7 samples / 1095 channels; see `.b127-experiment/B127-candidates-report.md`
 * on that branch): 33/139 channels reclassified on `vbo.loga` (the golden
 * fixture), 9 on mxApp, 24 on raceAmp, 25 on super2, 48 on superX, 0 on both
 * real `.rcz` files — every one of them digital->analog and an actual
 * analog quantity, with ZERO real flags demoted. The simpler alternatives were
 * worse: a name allowlist gate (V1/V2) demoted 4 real flags
 * (`EngineBrakeEn`, `TCCtrAct`, `GPS_Weak`, `Fuel.NBO2_CLReset`) because ECU
 * naming is inconsistent, and a plain numeric denylist (V3) demoted 13 real
 * flags on super2 (`Fuel8.RPM_Limit`, `Fuel10.MAPSW0-7`, …).
 *
 * Known residual: ~7 of 40 constant analog channels on `vbo.loga`
 * (`Fuel_CL`, `TPS_indx`, `Engine_Brake`, `DragPhase`, `DragRound`,
 * `SuspensionAD1/2`) have names too ambiguous to match and stay digital. Fix by
 * extending {@link NUMERIC_NAME} — and re-measure against the fixtures: any
 * extension must keep "0 real flags demoted".
 */

/** Names that follow an ECU boolean-flag convention (the allowlist; wins over {@link NUMERIC_NAME}). */
export const BOOL_NAME =
  /(?:_(?:on|en|act|sw|rdy|ready|trig|flag|cut|occur|limit)(?![a-z])|sw(?![a-z])|swon|malf|\.p[0-9a-f]{3,4}(?:_\d)?$|status\.|mode\d*\.)/i

/** Quantity nouns / units (the denylist) — only ever consulted for CONSTANT channels. */
export const NUMERIC_NAME =
  /(number|time|timer|count|cnt|counter|num(?![a-z])|rpm|map(?![a-z])|gear|temp|speed|dist|mileage|horsepower|percent|volt|level|rate|angle|thre|mult|sum|target|energy|soc|vcell|vtotal|_ad(?![a-z])|pw(?![a-z])|freq|press)/i

/** True when every finite sample is identical and at least one exists. */
export function isConstantChannel(data: ArrayLike<number>, n: number): boolean {
  let first: number | null = null
  for (let i = 0; i < n; i++) {
    const v = data[i]
    if (!Number.isFinite(v)) continue
    if (first === null) first = v
    else if (v !== first) return false
  }
  return first !== null
}

/**
 * Should a channel that PASSED the 0/1 value-range test be demoted to analog
 * on name evidence? See the module doc for the rule and its justification.
 * A channel with any variation (a toggling 0/1 signal) is never demoted,
 * whatever it is called.
 */
export function demoteConstantToAnalog(name: string, data: ArrayLike<number>, n: number): boolean {
  return isConstantChannel(data, n) && NUMERIC_NAME.test(name) && !BOOL_NAME.test(name)
}
