/**
 * VBO channel-mapping tables, ported from loga2vbo.py.
 *
 * Two output flavours share these tables:
 *  - Circuit Tools 3 (.vbo `_ct`): [header] keeps the original ECU names.
 *  - RaceChrono 10.2.x (.vbo `_rc`): [header] must be an official RaceChrono
 *    identifier with an `rc_` prefix (the app cannot rename channels), so every
 *    signal is either mapped to a known identifier or bucketed into a generic
 *    analog/digital slot — see {@link Allocator}.
 */

import { FIXED_IDENTIFIERS } from '@/domain/raceChrono/identifiers'

export interface Semantic {
  /** RaceChrono identifier (without the `rc_` prefix). */
  readonly ident: string
  /** Multiplier applied to the raw ECU value to reach the SI `unit`. */
  readonly scale: number
  /** SI unit RaceChrono expects. */
  readonly unit: string
}

/**
 * ECU canonical name → RaceChrono identifier + SI scaling. Only signals whose
 * identity *and* SI unit are certain are mapped here; everything else falls back
 * to a generic analog/digital bucket.
 */
export const SEMANTIC: Readonly<Record<string, Semantic>> = {
  RPM: { ident: 'rpm', scale: 1, unit: 'rpm' },
  // RC3 `$RC3` d1 is a FIXED RPM slot (see Rc3NmeaExporter.ts/mapping.ts and
  // RCZ-FORMAT-SPEC.md §5.3 — id 20002 "digital1" is displayed by RaceChrono
  // itself as RPM). The .rcz importer already names this channel
  // `rc_digital_1` and its data is already in RPM (int32ScaleFor's ÷1000),
  // so this is a straight passthrough with scale 1 — B121. Checked here
  // (before the identity-passthrough fallback in VboExporter.ts) so the
  // fixed RPM slot is never left as a bare identity `rc_digital_1`.
  rc_digital_1: { ident: 'rpm', scale: 1, unit: 'rpm' },
  TPS_Percent: { ident: 'throttle_pos', scale: 1, unit: '%' },
  T_Eng: { ident: 'coolant_temp', scale: 1, unit: 'degC' },
  T_Air_indx: { ident: 'intake_temp', scale: 1, unit: 'degC' },
  T_Air: { ident: 'intake_temp', scale: 1, unit: 'degC' },
  Volt_Batt_indx: { ident: 'ecu_voltage', scale: 1, unit: 'V' },
  Volt_Batt: { ident: 'ecu_voltage', scale: 1, unit: 'V' },
  AFR: { ident: 'air_fuel_ratio', scale: 1, unit: 'afr' },
  AFR_WBO2_CAL: { ident: 'air_fuel_ratio_2', scale: 1, unit: 'afr' },
  SA: { ident: 'timing_advance', scale: 1, unit: 'deg' },
  GearNum: { ident: 'gear', scale: 1, unit: 'gear' },
  TC_Lean_Angle: { ident: 'lean_angle', scale: 1, unit: 'deg' },
  TC_Xforce: { ident: 'x_acc', scale: 0.001, unit: 'g' }, // mg → g
  TC_Yforce: { ident: 'y_acc', scale: 0.001, unit: 'g' },
  TC_Zforce: { ident: 'z_acc', scale: 0.001, unit: 'g' },
  TC_Xangle_dps: { ident: 'x_rate_of_rotation', scale: 1, unit: 'deg/s' },
  TC_Yangle_dps: { ident: 'y_rate_of_rotation', scale: 1, unit: 'deg/s' },
  TC_Zangle_dps: { ident: 'z_rate_of_rotation', scale: 1, unit: 'deg/s' },
  Vehicle_Speed: { ident: 'wheel_speed', scale: 1, unit: 'km/h' },
  TC_VSSF: { ident: 'wheel_speed_front', scale: 1, unit: 'km/h' },
  TC_VSSR: { ident: 'wheel_speed_rear', scale: 1, unit: 'km/h' },
  Torque: { ident: 'engine_torque', scale: 1, unit: 'Nm' },
}

/**
 * ECU columns already folded into the 7 standard VBO GPS channels (so they are
 * not re-emitted as telemetry). Includes the GPS_UTC_* clock columns, which
 * feed the VBO time field and would otherwise show up as meaningless analogs.
 */
export const GPS_CONSUMED: ReadonlySet<string> = new Set([
  'Time',
  'GPS_Lat_NS',
  'GPS_Lon_EW',
  'GPS_Lat_deg',
  'GPS_Lat_min',
  'GPS_Lat_mmmm',
  'GPS_Lon_deg',
  'GPS_Lon_min',
  'GPS_Lon_mmmm',
  'GPS_Speed',
  'GPS_UTC_hh',
  'GPS_UTC_mm',
  'GPS_UTC_ss',
  'GPS_UTC_ms',
])

/** RaceChrono identifier postfix number ceiling (rc_<base>_1 .. _63). */
export const POSTFIX_MAX = 63

// Generic buckets. Each base id holds up to 63 channels; when one overflows the
// allocator spills into the next base. All are official RaceChrono base
// identifiers, and 0/1 values are safe to place in analog buckets too.
export const ANALOG_BASES = ['analog', 'frequency', 'voltage', 'current', 'power', 'angle']
export const DIGITAL_BASES = ['digital']

/** Every generic numbered base — the set `isRcIdentifier` accepts `rc_<base>_<n>` against. */
const GENERIC_BASES: ReadonlySet<string> = new Set([...ANALOG_BASES, ...DIGITAL_BASES])

/**
 * True when `name` is already a fully-qualified, valid RaceChrono `rc_`
 * identifier — either one of the fixed named signals ({@link
 * FIXED_IDENTIFIERS}, e.g. `rc_x_acc`) or a generic numbered slot within
 * range (`rc_analog_5`, `rc_digital_2`, …). Used by `VboExporter.ts` to pass
 * such a channel through unchanged instead of re-bucketing it (B120).
 *
 * Deliberately narrow: a `_dev<N>`-suffixed collision name like
 * `rc_x_acc_dev300` (produced when two devices decode the same channel id,
 * see `parseRczCore.ts`'s `pushUnique`) does NOT match — it must still go
 * through generic allocation, since RaceChrono itself would never recognise
 * that string as an identifier.
 */
export function isRcIdentifier(name: string): boolean {
  if (FIXED_IDENTIFIERS.has(name)) return true
  const m = /^rc_([a-z]+)_([1-9][0-9]*)$/.exec(name)
  if (!m) return false
  const [, base, numStr] = m
  if (!GENERIC_BASES.has(base)) return false
  return Number(numStr) <= POSTFIX_MAX
}

/**
 * Allocates generic channels to `rc_<base>_<n>` (n = 1..63 per base), spilling
 * to the next base when one fills up — mirrors loga2vbo.py's Allocator.
 *
 * Tracks issued names as an explicit set (not a per-base counter) so a name
 * already claimed by an identity passthrough (B120's {@link isRcIdentifier})
 * can be {@link reserve}d up front and `take()` will skip straight past it —
 * collisions between a passed-through channel and a later generically
 * numbered one are impossible, not merely unlikely, regardless of which
 * order the two channels appear in the session.
 */
export class Allocator {
  private readonly taken = new Set<string>()

  /** Reserve an already-decided name so `take()` never re-issues it. */
  reserve(name: string): void {
    this.taken.add(name)
  }

  take(bases: readonly string[]): string {
    for (const base of bases) {
      for (let n = 1; n <= POSTFIX_MAX; n++) {
        const name = `rc_${base}_${n}`
        if (!this.taken.has(name)) {
          this.taken.add(name)
          return name
        }
      }
    }
    throw new Error('generic channel count exceeds all bucket capacity')
  }
}

/**
 * Approximate the RaceChrono App's display label for an `rc_` identifier (used
 * only by the channel-map CSV for reference). Mirrors Python's str.title().
 */
export function humanize(rcName: string): string {
  const s = (rcName.startsWith('rc_') ? rcName.slice(3) : rcName).replace(/_/g, ' ').trim()
  return s.toLowerCase().replace(/[a-z]+/g, (w) => w[0].toUpperCase() + w.slice(1))
}
