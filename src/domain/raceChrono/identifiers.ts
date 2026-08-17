/**
 * RaceChrono `rc_` channel-identifier naming — the single source of truth
 * shared between the `.rcz` importer (which derives a channel's NAME from a
 * RaceChrono channel id, see `parseRcz.ts`'s `decodeRcChannelName`) and the
 * `.vbo` exporter (which must recognise when a channel's NAME is ALREADY a
 * valid RaceChrono identifier and pass it through unchanged instead of
 * re-bucketing it into a generic analog/digital slot — see docs/ISSUES.md
 * B120/B121). Keeping this table in one place means the accepted-identifier
 * set on the export side can never drift out of sync with the id->name table
 * the import side actually produces.
 */

/**
 * RaceChrono channel-id "low" code → canonical `rc_` identifier, for named
 * (non-generic, non-numbered) signals. `decodeRcChannelName` turns an id
 * into one of these names on import; `Object.values` of this table is
 * exactly the fixed (non-bucketed) identifier set an exporter must recognise
 * on the way back out.
 */
export const NAMED_LO: Readonly<Record<number, string>> = {
  10024: 'rc_rpm',
  1023: 'rc_air_fuel_ratio',
  10028: 'rc_timing_advance',
  10029: 'rc_intake_temp',
  10025: 'rc_throttle_pos',
  10026: 'rc_coolant_temp',
  10063: 'rc_ecu_voltage',
  66551: 'rc_wheel_speed_front',
  33783: 'rc_wheel_speed_rear',
  9: 'rc_x_acc',
  10: 'rc_y_acc',
  11: 'rc_z_acc',
  12: 'rc_x_rate_of_rotation',
  13: 'rc_y_rate_of_rotation',
  14: 'rc_z_rate_of_rotation',
  28: 'rc_x_magn',
  29: 'rc_y_magn',
  30: 'rc_z_magn',
}

/**
 * Fixed (non-numbered, no bank suffix) identifiers — `Object.values(NAMED_LO)`
 * deduplicated into a lookup set. Does NOT include the generic numbered
 * bases (`rc_analog_<n>`, `rc_digital_<n>`, …) — those are validated against
 * their own base-name list, see `domain/export/vbo/semantic.ts`'s
 * `isRcIdentifier`.
 */
export const FIXED_IDENTIFIERS: ReadonlySet<string> = new Set(Object.values(NAMED_LO))
