<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AccelSegment } from '@/domain/analysis/accelTest'
import type { AccelCondition } from '@/stores/analyzerStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { formatLapTime } from '@/domain/analysis/format'

const props = defineProps<{
  /** Best matching segment for the current condition, or null when nothing
   *  qualifies (see AnalyzerView's accelResult computed for the search call).
   *  Distinguished from "not computed yet" (below) by `speedAvailable`. */
  result: AccelSegment | null
  /** Whether the search even ran (speed channel + session present). */
  speedAvailable: boolean
}>()

const emit = defineEmits<{
  /** User asked to focus the found segment (zoom the charts/map to it). */
  focus: [segment: AccelSegment]
}>()

const { t } = useI18n()
const analyzer = useAnalyzerStore()

const condition = computed(() => analyzer.accelCondition)
const isDistance = computed(() => condition.value.kind === 'distance')

function setKind(kind: AccelCondition['kind']): void {
  if (kind === condition.value.kind) return
  analyzer.setAccelCondition(
    kind === 'distance'
      ? { kind: 'distance', distanceM: 100, minEntrySpeedKmh: null }
      : { kind: 'speed', fromKmh: 0, toKmh: 100 },
  )
}

function onDistanceInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (condition.value.kind !== 'distance') return
  analyzer.setAccelCondition({ ...condition.value, distanceM: Number.isFinite(v) && v > 0 ? v : 0 })
}

function onMinEntryInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value.trim()
  if (condition.value.kind !== 'distance') return
  const v = raw === '' ? null : Number(raw)
  analyzer.setAccelCondition({
    ...condition.value,
    minEntrySpeedKmh: v != null && Number.isFinite(v) ? v : null,
  })
}

function onFromInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (condition.value.kind !== 'speed') return
  analyzer.setAccelCondition({ ...condition.value, fromKmh: Number.isFinite(v) ? v : 0 })
}

function onToInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (condition.value.kind !== 'speed') return
  analyzer.setAccelCondition({ ...condition.value, toKmh: Number.isFinite(v) ? v : 0 })
}

function fmtSpeed(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(1)} km/h` : '—'
}

function fmtDist(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(1)} m` : '—'
}
</script>

<template>
  <div class="accel-test-panel">
    <div class="row kind-toggle" role="group" :aria-label="t('analyzer.accelKind')">
      <button
        type="button"
        :class="{ active: isDistance }"
        @click="setKind('distance')"
      >
        {{ t('analyzer.accelKindDistance') }}
      </button>
      <button
        type="button"
        :class="{ active: !isDistance }"
        @click="setKind('speed')"
      >
        {{ t('analyzer.accelKindSpeed') }}
      </button>
    </div>

    <div v-if="condition.kind === 'distance'" class="row params">
      <label class="field">
        <span>{{ t('analyzer.accelDistanceM') }}</span>
        <input
          type="number"
          inputmode="decimal"
          min="1"
          step="1"
          :value="condition.distanceM"
          @input="onDistanceInput"
        />
      </label>
      <label class="field">
        <span>{{ t('analyzer.accelMinEntry') }}</span>
        <input
          type="number"
          inputmode="decimal"
          min="0"
          step="1"
          :value="condition.minEntrySpeedKmh ?? ''"
          :placeholder="t('analyzer.accelMinEntryPlaceholder')"
          @input="onMinEntryInput"
        />
      </label>
    </div>

    <div v-else class="row params">
      <label class="field">
        <span>{{ t('analyzer.accelFromKmh') }}</span>
        <input
          type="number"
          inputmode="decimal"
          min="0"
          step="1"
          :value="condition.fromKmh"
          @input="onFromInput"
        />
      </label>
      <label class="field">
        <span>{{ t('analyzer.accelToKmh') }}</span>
        <input
          type="number"
          inputmode="decimal"
          min="0"
          step="1"
          :value="condition.toKmh"
          @input="onToInput"
        />
      </label>
    </div>

    <p v-if="!props.speedAvailable" class="hint">{{ t('analyzer.accelNoChannel') }}</p>
    <p v-else-if="props.result == null" class="hint">{{ t('analyzer.accelNoMatch') }}</p>
    <div v-else class="result">
      <span class="result-time">{{ formatLapTime(props.result.timeMs) }}</span>
      <span class="result-detail">{{ fmtDist(props.result.distanceM) }}</span>
      <span class="result-detail">
        {{ t('analyzer.accelEntryExit', {
          entry: fmtSpeed(props.result.entrySpeedKmh),
          exit: fmtSpeed(props.result.exitSpeedKmh),
        }) }}
      </span>
      <button type="button" class="focus-btn" @click="emit('focus', props.result)">
        {{ t('analyzer.accelFocus') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.accel-test-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: var(--space);
  padding-top: var(--space);
  border-top: 1px solid var(--color-border);
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.kind-toggle {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
  align-self: flex-start;
}
.kind-toggle button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 6px 12px;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.kind-toggle button.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.field {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.field input {
  width: 100px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.result {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--color-bg);
  font-size: 0.9rem;
}
.result-time {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}
.result-detail {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.focus-btn {
  margin-left: auto;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.focus-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
