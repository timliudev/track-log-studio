<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Lap } from '@/domain/model/Lap'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import { buildSessionLapSummaries } from '@/domain/analysis/sessionLapSummary'
import { formatLapTime } from '@/domain/analysis/format'

const props = defineProps<{
  primaryLaps: Lap[]
  primaryExcluded: number[]
  comparisons: ComparisonSession[]
}>()
const { t } = useI18n()
const summaries = computed(() => buildSessionLapSummaries(
  props.primaryLaps,
  props.primaryExcluded,
  props.comparisons,
))

function delta(value: number | null): string {
  if (value == null) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±'
  return `${sign}${(Math.abs(value) / 1000).toFixed(3)} s`
}
</script>

<template>
  <section v-if="summaries.length" class="session-summary">
    <h4>{{ t('analyzer.comparisonLapSummary') }}</h4>
    <div v-for="summary in summaries" :key="summary.id" class="summary-row">
      <span class="swatch" :style="{ background: summary.color }" />
      <span class="name" :title="summary.name">{{ summary.name }}</span>
      <span>{{ summary.fastestMs == null ? '—' : formatLapTime(summary.fastestMs) }}</span>
      <span class="delta">{{ delta(summary.deltaMs) }}</span>
      <span class="count">{{ t('analyzer.comparisonLapCount', { n: summary.lapCount }) }}</span>
    </div>
  </section>
</template>

<style scoped>
.session-summary { margin-top: 10px; border-top: 1px solid var(--color-border); padding-top: 8px; }
h4 { margin: 0 0 6px; font-size: .85rem; color: var(--color-text-muted); }
.summary-row { display: grid; grid-template-columns: 10px minmax(90px, 1fr) auto auto auto; gap: 7px; align-items: center; font-size: .82rem; }
.swatch { width: 9px; height: 9px; border-radius: 50%; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.delta, .count { color: var(--color-text-muted); }
</style>
