import { describe, it, expect } from 'vitest'
import { parseLoga } from '@/domain/parsing/LogaParser'
import {
  adToTravelMm,
  applyDerivedChannels,
  defaultSuspensionConfig,
  deriveSuspensionChannels,
  fitLinear,
  suggestConfig,
  type SuspensionChannelConfig,
  type SuspensionConfig,
} from '@/domain/units/suspension'
import { loadFixture } from '../fixtures'

function frontEnabled(patch: Partial<SuspensionChannelConfig> = {}): SuspensionConfig {
  const cfg = defaultSuspensionConfig()
  cfg.front = { ...cfg.front, enabled: true, source: 'AD1', maxMm: 120, ...patch }
  return cfg
}

describe('adToTravelMm', () => {
  const cfg: SuspensionChannelConfig = {
    enabled: true,
    source: 'AD1',
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
  it('derives Front_Susp_mm from SuspensionAD1 (RaceAMP)', () => {
    const session = parseLoga(loadFixture('raceAmp.loga'))
    const channels = deriveSuspensionChannels(session, frontEnabled())
    expect(channels).toHaveLength(1)
    expect(channels[0].name).toBe('Front_Susp_mm')
    expect(channels[0].data.length).toBe(session.rowCount)
    expect(Number.isFinite(channels[0].data[0])).toBe(true)
  })

  it('produces nothing when the source AD channel is absent (Super2)', () => {
    const session = parseLoga(loadFixture('super2.loga'))
    expect(deriveSuspensionChannels(session, frontEnabled())).toHaveLength(0)
  })

  it('augments the session so the derived channel is resolvable', () => {
    const session = parseLoga(loadFixture('raceAmp.loga'))
    const augmented = applyDerivedChannels(session, frontEnabled())
    expect(augmented.has('Front_Susp_mm')).toBe(true)
    expect(augmented.get('Front_Susp_mm')?.data.length).toBe(session.rowCount)
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
    const cfg: SuspensionChannelConfig = { enabled: true, source: 'AD1', ...sug }
    expect(adToTravelMm(2500, cfg)).toBeCloseTo(0.02 * 2500 - 30, 4)
    expect(adToTravelMm(4000, cfg)).toBeCloseTo(0.02 * 4000 - 30, 4)
  })
})
