<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LapExclusionIcon, { type LapExclusionReason } from './LapExclusionIcon.vue'

const props = defineProps<{ reasons: LapExclusionReason[] }>()
const { t } = useI18n()

const entries = computed(() => {
  const labels: Record<LapExclusionReason, string> = {
    manual: t('analyzer.excludedManually'),
    timeBand: t('analyzer.excludedByBand'),
    distBand: t('analyzer.excludedByDistanceBand'),
    sector: t('analyzer.excludedBySector'),
  }
  return props.reasons.map((reason) => ({ reason, label: labels[reason] }))
})
</script>

<template>
  <p v-if="entries.length" class="exclusion-legend">
    <span v-for="entry in entries" :key="entry.reason" class="legend-entry">
      <LapExclusionIcon :reason="entry.reason" />
      {{ entry.label }}
    </span>
  </p>
</template>

<style scoped>
.exclusion-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.75rem;
}
.legend-entry {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.legend-entry svg {
  width: 14px;
  height: 14px;
  flex: none;
}
</style>
