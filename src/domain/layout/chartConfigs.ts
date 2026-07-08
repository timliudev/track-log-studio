/**
 * T5 — Analyzer dashboard CHART-CARD persistence: which chart cards exist and
 * their per-chart config (kind, picked channels, timeline/overlay mode, X/Y
 * scatter channels).
 *
 * Closes the persistence gap the dashboard had until now: positions/sizes
 * were saved (dashboardLayout.v1) and collapse/pin/mobile-order too
 * (panelState.v1), but the charts ARRAY itself was transient store state — on
 * reload it reset to the single default chart, and reconcileLayout then
 * dropped the (correctly saved!) layout entries of every other chart card, so
 * dynamically added charts silently vanished across reloads.
 *
 * Deliberately a THIRD sibling storage key (same `aracer-loga.*.v1`
 * global-slot pattern as dashboardLayout.ts / panelState.ts, and the same
 * "device/UI preference, not per-circuit" rationale): chart configs are keyed
 * by the same stable chart id that `chartItemId()` derives card ids from, so
 * the three blobs reconcile against each other purely via ids.
 *
 * Channel NAMES are stored as plain strings. A restored chart whose channels
 * don't exist in the next loaded log degrades exactly like switching files
 * does today: TimeSeriesChart filters to present channels, ScatterChart
 * renders empty until a valid pick — nothing breaks, so no session-dependent
 * validation happens here.
 */

import { looksLikeForcePair } from '@/domain/analysis/ggData'

/** How a chart plots its channels — see analyzerStore (re-exported there). */
export type ChartMode = 'timeline' | 'overlay'

/** A time-series chart: N channels over a shared X. */
export interface TimeSeriesChartConfig {
  kind: 'timeseries'
  id: number
  channels: string[]
  mode: ChartMode
}

/** An XY scatter chart: any two channels plotted against each other. */
export interface ScatterChartConfig {
  kind: 'scatter'
  id: number
  xChannel: string | null
  yChannel: string | null
  /** Whether the X/Y axes are scaled 1:1 (equal pixels per data unit, so a
   *  circle plots as a circle) vs each axis auto-ranging independently to
   *  fill the card. Defaults to true ONLY when both channels look like a
   *  force/acceleration pair (see `looksLikeForcePair` — the aRacer G-G
   *  friction-circle use, where 1:1 is meaningful) and false for any other
   *  channel pair (e.g. RPM vs a small-range channel, where forcing true
   *  data-unit 1:1 scaling squashes the smaller-magnitude axis into a
   *  sliver — #5 in the equal-aspect fix). Always user-overridable via
   *  `setChartEqualAspect` regardless of this default. See GgChart.vue's
   *  `equalAspectGrid` for how the ON state survives a non-square card and
   *  window/card resizes. */
  equalAspect: boolean
}

/** One chart on the analyzer dashboard, discriminated on `kind`. */
export type ChartConfig = TimeSeriesChartConfig | ScatterChartConfig

export const STORAGE_KEY = 'aracer-loga.analyzerCharts.v1'

/** The pristine dashboard: one empty timeseries chart (id 1) — same default
 *  the store hardcoded before charts were persisted. */
export function defaultCharts(): ChartConfig[] {
  return [{ kind: 'timeseries', id: 1, channels: [], mode: 'timeline' }]
}

/** The id the NEXT added chart should get: one past the highest existing id
 *  (ids are never reused, so restored layouts/panel state can't collide with
 *  a new chart's card id). An empty list starts back at 1. */
export function nextChartId(charts: readonly ChartConfig[]): number {
  return charts.reduce((m, c) => Math.max(m, c.id), 0) + 1
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'string')
}

/**
 * Parse persisted JSON into a chart list, or null when missing/invalid
 * (caller falls back to {@link defaultCharts}). Permissive per entry —
 * malformed entries are skipped, duplicate ids keep the first occurrence —
 * same spirit as dashboardLayout's parseLayout. NOTE: a valid EMPTY array is
 * returned as `[]`, not null — "the user removed every chart" is a
 * legitimate persisted state and must survive a reload.
 */
export function parseCharts(raw: string | null): ChartConfig[] | null {
  if (!raw) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return null
    const seen = new Set<number>()
    const charts: ChartConfig[] = []
    for (const it of data as Record<string, unknown>[]) {
      if (!it || typeof it !== 'object') continue
      const id = it.id
      if (typeof id !== 'number' || !Number.isFinite(id) || seen.has(id)) continue
      if (it.kind === 'timeseries') {
        charts.push({
          kind: 'timeseries',
          id,
          channels: isStringArray(it.channels) ? it.channels : [],
          mode: it.mode === 'overlay' ? 'overlay' : 'timeline',
        })
        seen.add(id)
      } else if (it.kind === 'scatter') {
        const xChannel = typeof it.xChannel === 'string' ? it.xChannel : null
        const yChannel = typeof it.yChannel === 'string' ? it.yChannel : null
        charts.push({
          kind: 'scatter',
          id,
          xChannel,
          yChannel,
          // Missing/invalid (e.g. an older persisted chart from before this
          // field existed) backfills from the channel pair itself — see
          // `equalAspect`'s doc: true only for a force/acceleration pair,
          // false otherwise (not a blanket true — #5 in the equal-aspect
          // fix).
          equalAspect:
            typeof it.equalAspect === 'boolean' ? it.equalAspect : looksLikeForcePair(xChannel, yChannel),
        })
        seen.add(id)
      }
    }
    return charts
  } catch {
    return null
  }
}

export function loadCharts(): ChartConfig[] {
  try {
    return parseCharts(localStorage.getItem(STORAGE_KEY)) ?? defaultCharts()
  } catch {
    return defaultCharts()
  }
}

export function saveCharts(charts: readonly ChartConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(charts))
  } catch {
    // storage unavailable / quota — charts simply won't persist
  }
}
