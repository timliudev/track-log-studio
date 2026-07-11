import type { Aggregation } from '@/domain/analysis/lapAggregate'
import type { LapMetric } from '@/domain/analysis/lapMetrics'

/** Minimal shape of vue-i18n's `t` this module needs — kept loose so callers
 *  can pass their component's `useI18n().t` without a vue-i18n type import. */
export type Translate = (key: string, params?: Record<string, unknown>) => string

/** Localized label for an aggregation ('max'/'min'/'avg'), shared by the
 *  primary LapTable's column editor and {@link columnHeader}'s channel case. */
export function aggLabel(t: Translate, agg: Aggregation): string {
  return agg === 'max' ? t('analyzer.aggMax') : agg === 'min' ? t('analyzer.aggMin') : t('analyzer.aggAvg')
}

/**
 * Localized header for a configurable lap-table column's metric. Channel kind →
 * `${channel} · ${aggLabel}` (placeholder label until a channel is picked);
 * built-in kinds map to their own header label; sectorTime shows its 1-based
 * sector number (§11 E sectors are 0-based internally, 1-based for humans).
 *
 * Shared by the primary LapTable and any comparison-recording lap table so
 * headers read identically wherever the same column set is shown.
 */
export function columnHeader(t: Translate, metric: LapMetric): string {
  switch (metric.kind) {
    case 'channel':
      return `${metric.channel || t('analyzer.selectChannel')} · ${aggLabel(t, metric.agg)}`
    case 'lapTime':
      return t('analyzer.lapTime')
    case 'distance':
      return t('analyzer.lapDistance')
    case 'sectorTime':
      return t('analyzer.sectorTimeColumn', { n: metric.sector + 1 })
    case 'delta':
      return t('analyzer.deltaColumn')
  }
}
