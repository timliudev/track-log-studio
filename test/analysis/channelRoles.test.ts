import { describe, it, expect } from 'vitest'
import {
  resolveRoleChannel,
  heuristicRoleChannel,
  canonicalGearChannel,
  hashChannelRoleOverrides,
  type ChannelRole,
  type ChannelRoleOverrides,
} from '@/domain/analysis/channelRoles'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

function channel(
  name: string,
  opts: { rawName?: string; description?: string; unit?: string; length?: number } = {},
): Channel {
  return {
    name,
    rawName: opts.rawName ?? name,
    description: opts.description,
    unit: opts.unit,
    data: new Float32Array(opts.length ?? 10),
  }
}

function session(channels: Channel[]): LogSession {
  return new LogSession(channels, { formatId: 'synthetic', createdDate: null, headerInfo: {} })
}

describe('resolveRoleChannel — resolution order', () => {
  it('step 2 (canonical) wins when present, ignoring anything else', () => {
    const s = session([channel('RPM'), channel('EngineRPM_rpm')])
    expect(resolveRoleChannel(s, 'rpm')).toBe('RPM')
  })

  it('falls through to the heuristic when canonical finds nothing', () => {
    const s = session([channel('EngineRPM_rpm')])
    expect(resolveRoleChannel(s, 'rpm')).toBe('EngineRPM_rpm')
  })

  it('returns null when nothing matches at all', () => {
    const s = session([channel('CoolantTemp_degC'), channel('ThrottleDemand_pct')])
    expect(resolveRoleChannel(s, 'rpm')).toBeNull()
  })

  it('an override wins over BOTH canonical and heuristic', () => {
    const s = session([channel('RPM'), channel('rc_rpm')])
    const overrides: ChannelRoleOverrides = { rc_rpm: 'rpm' }
    expect(resolveRoleChannel(s, 'rpm', overrides)).toBe('rc_rpm')
  })

  it('an override for a channel absent from THIS session is ignored (falls through)', () => {
    const s = session([channel('RPM')])
    const overrides: ChannelRoleOverrides = { some_other_log_channel: 'rpm' }
    expect(resolveRoleChannel(s, 'rpm', overrides)).toBe('RPM')
  })

  it('an override for a role that finds nothing itself falls through to canonical/heuristic', () => {
    // Override maps a SPEED role to a channel that doesn't exist; rpm role
    // resolution for the same session must be unaffected.
    const s = session([channel('RPM')])
    const overrides: ChannelRoleOverrides = { GPS_Speed: 'speed' }
    expect(resolveRoleChannel(s, 'rpm', overrides)).toBe('RPM')
  })
})

describe('resolveRoleChannel — gear canonical step (regex parity)', () => {
  it('matches a separator-bounded gear channel (existing regex behaviour)', () => {
    const s = session([channel('GearPosition_deg')])
    expect(resolveRoleChannel(s, 'gear')).toBe('GearPosition_deg')
  })

  it('excludes a channel whose label contains "ratio" at both the canonical AND heuristic step', () => {
    const s = session([channel('Gear_Ratio')])
    expect(canonicalGearChannel(s)).toBeUndefined()
    expect(resolveRoleChannel(s, 'gear')).toBeNull()
  })

  it('does NOT match "GearPRND" (no separator after "gear") — this is the B134 gap', () => {
    const s = session([channel('GearPRND')])
    expect(canonicalGearChannel(s)).toBeUndefined()
    // but the heuristic step picks it up:
    expect(resolveRoleChannel(s, 'gear')).toBe('GearPRND')
  })
})

describe('heuristicRoleChannel — ranking', () => {
  it('rpm: exact "rpm" token wins uniquely', () => {
    const s = session([channel('EngineRPM_rpm'), channel('ThrottleDemand_pct')])
    expect(heuristicRoleChannel(s, 'rpm')).toBe('EngineRPM_rpm')
  })

  it('speed: a vehicle/GPS speed channel outranks an individual wheel-speed channel', () => {
    const s = session([channel('WheelSpeedFL_kmh'), channel('VehicleSpeed_kmh')])
    expect(heuristicRoleChannel(s, 'speed')).toBe('VehicleSpeed_kmh')
  })

  it('speed: a coarse wheel-speed variant ranks below the plain wheel-speed channel', () => {
    const s = session([channel('WheelSpeedFL_coarse_kmh'), channel('WheelSpeedFL_kmh')])
    expect(heuristicRoleChannel(s, 'speed')).toBe('WheelSpeedFL_kmh')
  })

  it('gear: a leading "Gear" token outranks a trailing one at the same tier (GearPRND vs CurrentGear)', () => {
    const s = session([channel('CurrentGear'), channel('GearPRND')])
    expect(heuristicRoleChannel(s, 'gear')).toBe('GearPRND')
  })

  it('rpm: a "_Limit"/"_Target"/"_Sim"/"_Demand" modifier is penalised below a clean channel', () => {
    const s = session([channel('RPM_Limit'), channel('EngineRPM_rpm')])
    expect(heuristicRoleChannel(s, 'rpm')).toBe('EngineRPM_rpm')
  })

  it('returns null (never guesses) when no channel clears the floor', () => {
    const s = session([channel('CoolantTemp_degC'), channel('BarometricPressure_kPa')])
    expect(heuristicRoleChannel(s, 'rpm')).toBeNull()
    expect(heuristicRoleChannel(s, 'speed')).toBeNull()
    expect(heuristicRoleChannel(s, 'gear')).toBeNull()
  })

  it('matches via unit alone when the name itself carries no keyword', () => {
    const s = session([channel('Revs', { unit: 'rpm' })])
    expect(heuristicRoleChannel(s, 'rpm')).toBe('Revs')
  })
})

describe('hashChannelRoleOverrides', () => {
  it('is stable under key reordering', () => {
    const a: ChannelRoleOverrides = { rc_rpm: 'rpm', VehicleSpeed_kmh: 'speed' }
    const b: ChannelRoleOverrides = { VehicleSpeed_kmh: 'speed', rc_rpm: 'rpm' }
    expect(hashChannelRoleOverrides(a)).toBe(hashChannelRoleOverrides(b))
  })

  it('differs when an entry changes', () => {
    const a: ChannelRoleOverrides = { rc_rpm: 'rpm' }
    const b: ChannelRoleOverrides = { rc_rpm: 'speed' as ChannelRole }
    expect(hashChannelRoleOverrides(a)).not.toBe(hashChannelRoleOverrides(b))
  })

  it('empty overrides hash consistently', () => {
    expect(hashChannelRoleOverrides({})).toBe(hashChannelRoleOverrides({}))
  })
})
