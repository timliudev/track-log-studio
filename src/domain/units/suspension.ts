import type { Channel } from '@/domain/model/types'
import { LogSession } from '@/domain/model/LogSession'

export type AdSource = 'AD1' | 'AD2'
export type SuspensionPart = 'front' | 'rear'

/** Calibration for one suspension channel (front or rear). 5 params, mv/mm. */
export interface SuspensionChannelConfig {
  enabled: boolean
  source: AdSource
  minMv: number
  maxMv: number
  zeroMv: number
  minMm: number
  maxMm: number
}

export interface SuspensionConfig {
  front: SuspensionChannelConfig
  rear: SuspensionChannelConfig
}

export const PARTS: readonly SuspensionPart[] = ['front', 'rear']

/**
 * Output channel names — deliberately the SAME as the loga's own Front/Rear
 * Suspension columns. The calibrated channel overrides the ECU's column (see
 * applyDerivedChannels), which keeps the field name stable for the future
 * "save modified .loga" step (Phase 3) and for analysis.
 */
export const OUTPUT_NAME: Record<SuspensionPart, string> = {
  front: 'Front Suspension',
  rear: 'Rear Suspension',
}

/** The ECU's own computed travel columns, read as the reverse-calc reference. */
export const ECU_NAME = OUTPUT_NAME

const DERIVED_DESC: Record<SuspensionPart, string> = {
  front: '前避震行程 (校正)',
  rear: '後避震行程 (校正)',
}

export function adChannelName(source: AdSource): string {
  return source === 'AD1' ? 'SuspensionAD1' : 'SuspensionAD2'
}

export function defaultSuspensionConfig(): SuspensionConfig {
  const base = (source: AdSource): SuspensionChannelConfig => ({
    enabled: false,
    source,
    minMv: 0,
    maxMv: 5000,
    zeroMv: 0,
    minMm: 0,
    maxMm: 0,
  })
  return { front: base('AD1'), rear: base('AD2') }
}

/**
 * Voltage (mv) → travel (mm), relative to the zero-point voltage. Linear
 * transfer defined by (minMv,minMm)–(maxMv,maxMm); output is offset so that
 * zeroMv reads 0mm. Returns NaN if the voltage span is degenerate.
 */
export function adToTravelMm(adMv: number, cfg: SuspensionChannelConfig): number {
  const span = cfg.maxMv - cfg.minMv
  if (span === 0) return NaN
  const pos = (v: number): number =>
    cfg.minMm + ((v - cfg.minMv) / span) * (cfg.maxMm - cfg.minMm)
  return pos(adMv) - pos(cfg.zeroMv)
}

/**
 * Names of derived channels that WOULD be produced for this session (no data
 * computed) — cheap, for the field picker. Detection is by actual column
 * presence (session.has), not by file format.
 */
export function derivedSuspensionNames(
  session: LogSession,
  config: SuspensionConfig,
): { name: string; description: string }[] {
  const out: { name: string; description: string }[] = []
  for (const part of PARTS) {
    const cfg = config[part]
    if (cfg.enabled && session.has(adChannelName(cfg.source))) {
      out.push({ name: OUTPUT_NAME[part], description: DERIVED_DESC[part] })
    }
  }
  return out
}

/** Compute the enabled derived suspension channels for a session. */
export function deriveSuspensionChannels(
  session: LogSession,
  config: SuspensionConfig,
): Channel[] {
  const out: Channel[] = []
  for (const part of PARTS) {
    const cfg = config[part]
    if (!cfg.enabled) continue
    const ad = session.get(adChannelName(cfg.source))?.data
    if (!ad) continue
    const data = new Float32Array(ad.length)
    for (let i = 0; i < ad.length; i++) data[i] = adToTravelMm(ad[i], cfg)
    out.push({
      name: OUTPUT_NAME[part],
      rawName: OUTPUT_NAME[part],
      description: DERIVED_DESC[part],
      data,
    })
  }
  return out
}

/**
 * Return a LogSession with the calibrated suspension channels applied. A derived
 * channel OVERRIDES the ECU's same-named column (Front/Rear Suspension) if it
 * exists, otherwise it is appended. The in-memory session is replaced; the
 * source .loga file is never modified.
 */
export function applyDerivedChannels(
  session: LogSession,
  config: SuspensionConfig,
): LogSession {
  const derived = deriveSuspensionChannels(session, config)
  if (derived.length === 0) return session
  const byName = new Map(derived.map((c) => [c.name, c]))
  const existing = new Set(session.channels.map((c) => c.name))
  const merged = session.channels.map((c) => byName.get(c.name) ?? c)
  for (const d of derived) if (!existing.has(d.name)) merged.push(d)
  return new LogSession(merged, session.meta)
}

// --- reverse-calc: recover the ECU's linear transfer from (AD, mm) pairs ---

export interface LinearFit {
  /** slope (mm per mv) */
  k: number
  /** intercept (mm at 0mv) */
  c: number
  /** coefficient of determination */
  r2: number
  /** number of valid sample pairs used */
  n: number
}

/**
 * Least-squares fit of `mm = k·ad + c` over paired samples. Returns null when
 * the data can't support a fit: too few points, AD barely varies, or the ECU
 * mm is constant/empty (scenario F — original app never set the calibration).
 */
export function fitLinear(
  adData: Float32Array | undefined,
  mmData: Float32Array | undefined,
): LinearFit | null {
  if (!adData || !mmData) return null
  const len = Math.min(adData.length, mmData.length)
  let n = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  let syy = 0
  let adMin = Infinity
  let adMax = -Infinity
  let mmMin = Infinity
  let mmMax = -Infinity
  for (let i = 0; i < len; i++) {
    const x = adData[i]
    const y = mmData[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    n++
    sx += x
    sy += y
    sxx += x * x
    sxy += x * y
    syy += y * y
    if (x < adMin) adMin = x
    if (x > adMax) adMax = x
    if (y < mmMin) mmMin = y
    if (y > mmMax) mmMax = y
  }
  if (n < 10) return null
  if (adMax - adMin < 1) return null // AD essentially constant (mv)
  if (mmMax - mmMin < 1e-6) return null // mm constant/empty (scenario F)

  const denom = n * sxx - sx * sx
  if (denom === 0) return null
  const k = (n * sxy - sx * sy) / denom
  const c = (sy - k * sx) / n

  const meanY = sy / n
  const ssTot = syy - n * meanY * meanY
  const ssRes =
    syy - 2 * k * sxy - 2 * c * sy + k * k * sxx + 2 * k * c * sx + n * c * c
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0
  return { k, c, r2, n }
}

/**
 * Turn a recovered linear transfer into a usable 5-param set. The 5 params are
 * over-determined (a line has only 2 DOF), so we pin the voltage span and
 * derive the rest — one valid choice among infinitely many.
 */
export function suggestConfig(
  fit: LinearFit,
  vmin = 0,
  vmax = 5000,
): Pick<SuspensionChannelConfig, 'minMv' | 'maxMv' | 'zeroMv' | 'minMm' | 'maxMm'> {
  const { k, c } = fit
  return {
    minMv: vmin,
    maxMv: vmax,
    minMm: k * vmin + c,
    maxMm: k * vmax + c,
    zeroMv: k !== 0 ? -c / k : 0,
  }
}
