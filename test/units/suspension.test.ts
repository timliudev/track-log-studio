import { describe, it, expect } from 'vitest'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { LogSession } from '@/domain/model/LogSession'
import {
  adToTravelMm,
  applyDerivedChannels,
  defaultSuspensionConfig,
  deriveSuspensionChannels,
  fitLinear,
  legacyAdChannelName,
  suggestConfig,
  type SuspensionChannelConfig,
  type SuspensionConfig,
  normalizeSuspensionConfig,
} from '@/domain/units/suspension'
import { loadFixture } from '../fixtures'

function frontEnabled(patch: Partial<SuspensionChannelConfig> = {}): SuspensionConfig {
  const cfg = defaultSuspensionConfig()
  cfg.front = { ...cfg.front, enabled: true, sourceChannel: 'SuspensionAD1', maxMm: 120, ...patch }
  return cfg
}

describe('adToTravelMm', () => {
  const cfg: SuspensionChannelConfig = {
    enabled: true,
    sourceChannel: 'SuspensionAD1',
    minMv: 0,
    maxMv: 5000,
    zeroMv: 0,
    minMm: 0,
    maxMm: 120,
  }

  it('maps the voltage span linearly to the travel span', () => {
    expect(adToTravelMm(0, cfg)).toBeCloseTo(0, 6)
    expect(adToTravelMm(2500, cfg)).toBeCloseTo(60, 6)
    expect(adToTravelMm(5000, cfg)).toBeCloseTo(120, 6)
  })

  it('offsets output so the zero-point voltage reads 0mm', () => {
    const z = { ...cfg, zeroMv: 1000 }
    expect(adToTravelMm(1000, z)).toBeCloseTo(0, 6)
    expect(adToTravelMm(5000, z)).toBeCloseTo(96, 6) // 120 - 24
  })

  it('returns NaN for a degenerate voltage span', () => {
    expect(Number.isNaN(adToTravelMm(100, { ...cfg, minMv: 100, maxMv: 100 }))).toBe(true)
  })
})

describe('derived suspension channels', () => {
  it('derives the Front Suspension channel from SuspensionAD1 (RaceAMP)', () => {
    const session = parseLoga(loadFixture('raceAmp.loga'))
    const channels = deriveSuspensionChannels(session, frontEnabled())
    expect(channels).toHaveLength(1)
    expect(channels[0].name).toBe('Front Suspension')
    expect(channels[0].data.length).toBe(session.rowCount)
    expect(Number.isFinite(channels[0].data[0])).toBe(true)
  })

  it('produces nothing when the source AD channel is absent (Super2)', () => {
    const session = parseLoga(loadFixture('super2.loga'))
    expect(deriveSuspensionChannels(session, frontEnabled())).toHaveLength(0)
  })

  it('overrides the ECU Front Suspension column (same name, no duplicate)', () => {
    const session = parseLoga(loadFixture('raceAmp.loga'))
    const ecuValue = session.get('Front Suspension')?.data[0]
    const augmented = applyDerivedChannels(session, frontEnabled())
    // same number of channels (overridden, not appended)
    expect(augmented.channels.length).toBe(session.channels.length)
    expect(augmented.get('Front Suspension')?.data.length).toBe(session.rowCount)
    // calibrated value differs from the ECU's original
    expect(augmented.get('Front Suspension')?.data[0]).not.toBe(ecuValue)
  })

  it('is format-agnostic: derives from ANY channel name, not just SuspensionAD1/2 (e.g. a non-.loga import)', () => {
    // Simulate a non-.loga session (e.g. VBO/RCZ) that happens to carry an
    // analog suspension-pot channel under an arbitrary name — sourceChannel
    // is a free channel name, so calibration must work identically here.
    const session = parseLoga(loadFixture('raceAmp.loga'))
    const raw = session.get('SuspensionAD1')!.data
    const renamed = new LogSession(
      session.channels.map((c) => (c.name === 'SuspensionAD1' ? { ...c, name: 'Analog_Channel_7' } : c)),
      session.meta,
    )
    const cfg = frontEnabled({ sourceChannel: 'Analog_Channel_7' })
    const channels = deriveSuspensionChannels(renamed, cfg)
    expect(channels).toHaveLength(1)
    expect(channels[0].data.length).toBe(raw.length)
  })

  it('produces nothing when sourceChannel is empty (unset)', () => {
    const session = parseLoga(loadFixture('raceAmp.loga'))
    expect(deriveSuspensionChannels(session, frontEnabled({ sourceChannel: '' }))).toHaveLength(0)
  })
})

describe('legacyAdChannelName (v1 -> v2 migration helper)', () => {
  it('maps the two hardcoded v1 sources to their .loga channel names', () => {
    expect(legacyAdChannelName('AD1')).toBe('SuspensionAD1')
    expect(legacyAdChannelName('AD2')).toBe('SuspensionAD2')
  })
})

describe('normalizeSuspensionConfig', () => {
  it('copies a complete serializable calibration without retaining caller references', () => {
    const config = frontEnabled({ sourceChannel: 'FrontPot' })
    config.rear = { ...config.rear, sourceChannel: 'RearPot', maxMm: 110 }
    const normalized = normalizeSuspensionConfig(config)
    expect(normalized).toEqual(config)
    expect(normalized).not.toBe(config)
    expect(normalized!.front).not.toBe(config.front)
  })

  it('rejects incomplete or non-finite calibration fields', () => {
    expect(normalizeSuspensionConfig({ front: { enabled: true, sourceChannel: 'A' }, rear: {} })).toBeNull()
    expect(normalizeSuspensionConfig({
      front: { enabled: true, sourceChannel: 'A', minMv: 0, maxMv: Infinity, zeroMv: 0, minMm: 0, maxMm: 100 },
      rear: { enabled: false, sourceChannel: 'B', minMv: 0, maxMv: 5000, zeroMv: 0, minMm: 0, maxMm: 100 },
    })).toBeNull()
  })
})

describe('reverse-calc', () => {
  it('recovers slope and intercept from a linear relationship', () => {
    const n = 200
    const ad = new Float32Array(n)
    const mm = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      ad[i] = (i / (n - 1)) * 5000
      mm[i] = 0.02 * ad[i] - 30
    }
    const fit = fitLinear(ad, mm)
    expect(fit).not.toBeNull()
    expect(fit!.k).toBeCloseTo(0.02, 4)
    expect(fit!.c).toBeCloseTo(-30, 3)
    expect(fit!.r2).toBeCloseTo(1, 4)
  })

  it('returns null when the ECU mm is constant/empty (scenario F)', () => {
    const ad = new Float32Array(50).map((_, i) => i * 100)
    const mm = new Float32Array(50) // all zeros
    expect(fitLinear(ad, mm)).toBeNull()
  })

  it('returns null with too few points', () => {
    expect(fitLinear(new Float32Array([0, 100, 200]), new Float32Array([0, 2, 4]))).toBeNull()
  })

  it('suggestConfig reproduces the fitted line via adToTravelMm', () => {
    const sug = suggestConfig({ k: 0.02, c: -30, r2: 1, n: 200 })
    const cfg: SuspensionChannelConfig = { enabled: true, sourceChannel: 'SuspensionAD1', ...sug }
    expect(adToTravelMm(2500, cfg)).toBeCloseTo(0.02 * 2500 - 30, 4)
    expect(adToTravelMm(4000, cfg)).toBeCloseTo(0.02 * 4000 - 30, 4)
  })
})
