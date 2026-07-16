<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import type { Lap } from '@/domain/model/Lap'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import { useSectorStore } from '@/stores/sectorStore'
import { useLapStore } from '@/stores/lapStore'
import { useSectors } from '@/composables/useSectors'
import { computeSectorTimes, computeOptimalLap } from '@/domain/analysis/sectorTiming'
import { formatLapTime } from '@/domain/analysis/format'
import CardFillScroll from '@/components/CardFillScroll.vue'

const props = withDefaults(defineProps<{
  laps: Lap[]
  invalidCount: number
  allFailed?: boolean
  track: GpsTrack | null
  timeMs: Float64Array | null
  /** Current map hover sample, so "add gate" can drop a gate at the cursor
   *  position rather than always at the reference lap's midpoint. */
  cursorIdx: number | null
}>(), { allFailed: false })

const { t } = useI18n()
const sectorStore = useSectorStore()
const lapStore = useLapStore()
const { gates, edited } = storeToRefs(sectorStore)
const lapsRef = computed(() => props.laps)
const { runAutoDetect, addGateAtCursor, reorderGates } = useSectors(lapsRef)
const autoDetectHint = ref(false)

// Re-detect clobbers any manual edits (add/remove/drag) — confirm first so a
// user who's been hand-tuning gates doesn't lose that work to an accidental
// re-click. No confirm needed when the set is untouched since detect (or
// empty) — re-running detect is then a safe no-op-ish refresh.
function onAutoDetect(): void {
  if (edited.value && gates.value.length > 0 && !window.confirm(t('analyzer.sectorRedetectConfirm'))) {
    return
  }
  autoDetectHint.value = !runAutoDetect()
}

function onAddGate(): void {
  addGateAtCursor(props.cursorIdx)
}

function onRemoveGate(i: number): void {
  sectorStore.removeGate(i)
  reorderGates()
}

// Theoretical-best (optimal) lap: only meaningful once at least one gate
// exists AND laps/track/time are available — derived, not stored, so it
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
  <CardFillScroll class="sector-panel">
    <template #header>
      <div class="row">
        <button type="button" class="detect" @click="onAutoDetect">
          {{ t('analyzer.sectorAutoDetect') }}
        </button>
        <button type="button" class="add" @click="onAddGate">
          {{ t('analyzer.sectorAddGate') }}
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
        <span v-else-if="allFailed" class="invalid-count" role="status">
          {{ t('analyzer.sectorAllFailedWarning') }}
        </span>
        <span v-if="autoDetectHint" class="detect-hint" role="status">
          {{ t('analyzer.sectorAutoDetectNoValidLap') }}
        </span>
      </div>

      <!-- B47 — theoretical-best (optimal) lap summary (§11 E): min per-sector
           time across complete, non-excluded laps, and which lap owns each
           best. Moved into the fixed `#header` (alongside the auto-detect/add-
           gate controls, ABOVE the scrollable gate list) so it stays visible
           even when the card is resized short enough that the gate list would
           otherwise scroll it out of view — see CardFillScroll's module doc:
           only the default slot scrolls, `#header` always renders at its
           natural height. -->
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
    </template>

    <ul v-if="gates.length > 0" class="gate-list">
      <li v-for="(_g, i) in gates" :key="i">
        <span class="gate-index">{{ i + 1 }}</span>
        <span class="gate-label">{{ t('analyzer.sectorGateLabel', { n: i + 1 }) }}</span>
        <button
          type="button"
          class="gate-remove"
          :aria-label="t('analyzer.sectorRemoveGate', { n: i + 1 })"
          @click="onRemoveGate(i)"
        >
          ✕
        </button>
      </li>
    </ul>
  </CardFillScroll>
</template>

<style scoped>
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
.detect,
.add {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.detect:hover,
.add:hover {
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
.detect-hint {
  flex-basis: 100%;
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
.gate-list {
  /* B24b — no own max-height/overflow: CardFillScroll's content pane is the
     real scroll parent now, so the list fills/scrolls with the card's actual
     size instead of being capped at a fixed pixel height (same fix as
     AccelTestPanel's B24 result-list). */
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.gate-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius);
  background: var(--color-bg);
  font-size: 0.85rem;
}
.gate-index {
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
.gate-label {
  flex: 1;
  color: var(--color-text);
}
.gate-remove {
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 2px 8px;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  background: var(--color-surface);
  color: var(--color-text-muted);
}
.gate-remove:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
