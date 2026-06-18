/**
 * RC3 analog/digital slot mapping. RaceChrono's $RC3 sentence has a fixed set
 * of user-assignable slots — one digital (d2) and fifteen analog (a1..a15) —
 * that the converter UI lets the user map to .loga channels. The fixed slots
 * (acc/gyro/rpm) are auto-filled by the exporter and are NOT part of this map.
 */

export const SLOT_IDS = [
  'd2',
  'a1',
  'a2',
  'a3',
  'a4',
  'a5',
  'a6',
  'a7',
  'a8',
  'a9',
  'a10',
  'a11',
  'a12',
  'a13',
  'a14',
  'a15',
] as const

export type SlotId = (typeof SLOT_IDS)[number]

export interface SlotMapping {
  /** Canonical .loga channel name, or null when the slot is unused. */
  channel: string | null
  /** Decimal places to format the value with. */
  decimals: number
}

export type Rc3Mapping = Record<SlotId, SlotMapping>

/** Build a full mapping, filling unspecified slots as unused. */
export function makeMapping(
  partial: Partial<Record<SlotId, SlotMapping>>,
): Rc3Mapping {
  const map = {} as Rc3Mapping
  for (const id of SLOT_IDS) {
    map[id] = partial[id] ?? { channel: null, decimals: 3 }
  }
  return map
}

/**
 * App default preset (the user's preferred signal set). Editable in the UI and
 * savable as user presets. Channels absent from a given log are emitted empty.
 */
export const DEFAULT_PRESET: Rc3Mapping = makeMapping({
  d2: { channel: 'TPS_Percent', decimals: 1 },
  a1: { channel: 'T_Eng', decimals: 1 },
  a2: { channel: 'T_Air', decimals: 1 },
  a3: { channel: 'SA', decimals: 1 },
  a4: { channel: 'Volt_Batt', decimals: 2 },
  a5: { channel: 'AFR', decimals: 2 },
  a6: { channel: 'ISC_Air_Flow', decimals: 1 },
  a7: { channel: 'MGU_A', decimals: 2 },
  a8: { channel: 'P_atm', decimals: 1 },
  a9: { channel: 'TC_Lean_Angle', decimals: 2 },
  a10: { channel: 'Vehicle_Speed', decimals: 1 },
  a11: { channel: 'GearNum', decimals: 0 },
  a12: { channel: 'TC_VSSF', decimals: 1 },
  a13: { channel: 'TC_VSSR', decimals: 1 },
  a14: { channel: 'TC_Wheelie_Angle', decimals: 2 },
  a15: { channel: 'Cyl1_Eng_AP', decimals: 1 },
})

/**
 * Legacy mapping matching loga2nmea.py exactly (a1..a8, d2 + a9..a15 unused,
 * with the same per-field decimals). Used as the regression anchor against the
 * Python golden samples.
 */
export const LEGACY_PY_MAPPING: Rc3Mapping = makeMapping({
  a1: { channel: 'TPS_Percent', decimals: 1 },
  a2: { channel: 'T_Eng', decimals: 1 },
  a3: { channel: 'Vehicle_Speed', decimals: 1 },
  a4: { channel: 'GPS_Speed', decimals: 1 },
  a5: { channel: 'AFR', decimals: 2 },
  a6: { channel: 'GearNum', decimals: 0 },
  a7: { channel: 'TC_Lean_Angle', decimals: 2 },
  a8: { channel: 'Volt_Batt', decimals: 2 },
})
