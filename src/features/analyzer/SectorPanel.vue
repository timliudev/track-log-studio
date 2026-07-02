<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import type { Lap } from '@/domain/model/Lap'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import { useSectorStore } from '@/stores/sectorStore'
import { useLapStore } from '@/stores/lapStore'
import { useSectors } from '@/composables/useSectors'
import { computeSectorTimes, computeOptimalLap } from '@/domain/analysis/sectorTiming'
import { formatLapTime } from '@/domain/analysis/format'

const props = defineProps<{
  laps: Lap[]
  invalidCount: number
  track: GpsTrack | null
  timeMs: Float64Array | null
}>()

const { t } = useI18n()
const sectorStore = useSectorStore()
const lapStore = useLapStore()
const { gates, suggestions } = storeToRefs(sectorStore)
const lapsRef = computed(() => props.laps)
const { runAutoDetect } = useSectors(lapsRef)

// Theoretical-best (optimal) lap: only meaningful once at least one gate is
// confirmed AND laps/track/time are available — derived, not stored, so it
// stays in sync with laps/gates/exclusions automatically.
const optimalLap = computed(() => {
  if (gates.value.length === 0 || !props.track || !props.timeMs) return null
  const timings = computeSectorTimes(props.laps, props.track, props.timeMs, gates.value)
  return computeOptimalLap(timings, lapStore.excluded)
})

const hasOptimalData = computed(
  () => optimalLap.value != null && Number.isFinite(optimalLap.value.optimalLapMs),
)
</script>

<template>
  <div class="sector-panel">
    <div class="row">
      <button type="button" class="detect" @click="runAutoDetect">
        {{ t('analyzer.sectorAutoDetect') }}
      </button>
      <span class="count">
        {{ t('analyzer.sectorGateCount', { n: gates.length }) }}
      </span>
      <button v-if="gates.length > 0" type="button" class="clear" @click="sectorStore.clearGates()">
        {{ t('analyzer.sectorClearGates') }}
      </button>
      <span v-if="invalidCount > 0" class="invalid-count">
        {{ t('analyzer.sectorInvalidCount', { x: invalidCount }) }}
      </span>
    </div>

    <!-- Theoretical-best (optimal) lap summary (§11 E): min per-sector time
         across complete, non-excluded laps, and which lap owns each best. -->
    <div v-if="gates.length > 0" class="optimal">
      <div class="optimal-title">{{ t('analyzer.optimalLapTitle') }}</div>
      <template v-if="hasOptimalData && optimalLap">
        <div class="optimal-total">
          {{ t('analyzer.optimalLapTime', { t: formatLapTime(optimalLap.optimalLapMs) }) }}
        </div>
        <ul class="optimal-sectors">
          <li v-for="(s, i) in optimalLap.bestSectors" :key="i">
            {{
              t('analyzer.optimalLapSector', {
                n: i + 1,
                t: Number.isFinite(s.bestMs) ? formatLapTime(s.bestMs) : '—',
                lap: s.lapIndex != null ? s.lapIndex + 1 : '—',
              })
            }}
          </li>
        </ul>
      </template>
      <p v-else class="optimal-empty">{{ t('analyzer.optimalLapNoData') }}</p>
    </div>

    <div v-if="suggestions.length > 0" class="suggestions">
      <div class="sug-header">
        <span>{{ t('analyzer.sectorSuggestionCount', { n: suggestions.length }) }}</span>
        <div class="sug-actions">
          <button type="button" @click="sectorStore.acceptAllSuggestions()">
            {{ t('analyzer.sectorAcceptAll') }}
          </button>
          <button type="button" @click="sectorStore.clearSuggestions()">
            {{ t('analyzer.sectorRejectAll') }}
          </button>
        </div>
      </div>
      <ul class="sug-list">
        <li v-for="(s, i) in suggestions" :key="i">
          <span class="sug-index">{{ i + 1 }}</span>
          <span class="sug-dist">{{ (s.lapDistanceM / 1000).toFixed(2) }} km</span>
          <span class="sug-buttons">
            <button type="button" class="accept" @click="sectorStore.acceptSuggestion(i)">
              {{ t('analyzer.sectorAccept') }}
            </button>
            <button type="button" class="reject" @click="sectorStore.rejectSuggestion(i)">
              {{ t('analyzer.sectorReject') }}
            </button>
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.sector-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: var(--space);
  padding-top: var(--space);
  border-top: 1px solid var(--color-border);
}
.optimal {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--color-bg);
  font-size: 0.85rem;
}
.optimal-title {
  color: var(--color-text-muted);
  font-weight: 600;
}
.optimal-total {
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}
.optimal-sectors {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.optimal-empty {
  color: var(--color-text-muted);
  margin: 0;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.detect {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.detect:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.count {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.invalid-count {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.clear {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.85rem;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
}
.suggestions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.sug-actions {
  display: flex;
  gap: 8px;
}
.sug-actions button {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 4px 8px;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.sug-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
}
.sug-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  border-radius: var(--radius);
  background: var(--color-bg);
  font-size: 0.85rem;
}
.sug-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid var(--color-accent);
  color: var(--color-text);
  font-size: 0.75rem;
  line-height: 1;
}
.sug-dist {
  color: var(--color-text);
  margin-left: 6px;
}
.sug-buttons {
  display: flex;
  gap: 6px;
}
.sug-buttons button {
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 2px 8px;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  background: var(--color-surface);
  color: var(--color-text);
}
.sug-buttons .accept:hover {
  border-color: #00c2ff;
  color: #00c2ff;
}
.sug-buttons .reject:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
