<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useLapStore } from '@/stores/lapStore'
import { lapColor } from './lapColors'
import type { Lap } from '@/domain/model/Lap'

// Selected laps in colour order; the panel only ever shows when ≥2 are selected
// (alignment is a comparison between laps), but it renders whatever it's given.
const props = defineProps<{ selectedLaps: Lap[] }>()

const { t } = useI18n()
const analyzer = useAnalyzerStore()
const { xAxis } = storeToRefs(analyzer)
const lapStore = useLapStore()

// Nudge step per axis: 0.05 s for time, 1 m for distance — fine enough for the
// sub-sample GNSS misalignment this corrects, in the overlay's own X units.
const step = computed(() => (xAxis.value === 'distance' ? 1 : 0.05))
const unit = computed(() => (xAxis.value === 'distance' ? 'm' : 's'))

/** Signed, axis-appropriate label for an offset value (e.g. '+0.15s', '−3m', '0'). */
function fmt(v: number): string {
  if (v === 0) return '0'
  const sign = v > 0 ? '+' : '−'
  const abs = Math.abs(v)
  const num = xAxis.value === 'distance' ? abs.toFixed(0) : abs.toFixed(2)
  return `${sign}${num}${unit.value}`
}

const anyOffset = computed(() =>
  props.selectedLaps.some((l) => lapStore.offsetOf(l.index, xAxis.value) !== 0),
)

function nudge(index: number, dir: -1 | 1): void {
  lapStore.nudgeOffset(index, xAxis.value, dir * step.value)
}

// Reset the CHART offset of the shown (selected) laps only; map offsets are left
// untouched (those have their own panel/reset).
function resetAll(): void {
  props.selectedLaps.forEach((l) => lapStore.resetOffset(l.index))
}
</script>

<template>
  <section class="align" :aria-label="t('analyzer.alignTitle')">
    <div class="head">
      <span class="title">{{ t('analyzer.alignTitle') }}</span>
      <button v-if="anyOffset" type="button" class="reset-all" @click="resetAll">
        {{ t('analyzer.alignResetAll') }}
      </button>
    </div>
    <p class="hint">{{ t('analyzer.alignHint') }}</p>
    <ul class="rows">
      <li v-for="(lap, order) in selectedLaps" :key="lap.index" class="row">
        <span class="swatch" :style="{ background: lapColor(order) }" />
        <span class="name">#{{ lap.index + 1 }}</span>
        <div class="nudge">
          <button
            type="button"
            v-tooltip="t('analyzer.alignEarlier')"
            :aria-label="t('analyzer.alignEarlier')"
            @click="nudge(lap.index, -1)"
          >
            −
          </button>
          <span class="value" :class="{ zero: lapStore.offsetOf(lap.index, xAxis) === 0 }">
            {{ fmt(lapStore.offsetOf(lap.index, xAxis)) }}
          </span>
          <button
            type="button"
            v-tooltip="t('analyzer.alignLater')"
            :aria-label="t('analyzer.alignLater')"
            @click="nudge(lap.index, 1)"
          >
            ＋
          </button>
        </div>
        <button
          type="button"
          class="reset"
          :disabled="lapStore.offsetOf(lap.index, xAxis) === 0"
          v-tooltip="t('analyzer.alignResetLap')"
          :aria-label="t('analyzer.alignResetLap')"
          @click="lapStore.resetOffset(lap.index)"
        >
          ↺
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.align {
  display: flex;
  flex-direction: column;
  gap: var(--space);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.title {
  font-weight: 600;
}
.hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.reset-all {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.reset-all:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: none;
  box-shadow: 0 0 0 1px var(--color-surface);
}
.name {
  min-width: 2.5em;
  font-size: 0.9rem;
}
.nudge {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.nudge button {
  background: var(--color-bg);
  color: var(--color-text);
  border: none;
  width: 32px;
  height: 30px;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}
.nudge button:hover {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.value {
  min-width: 5.5em;
  text-align: center;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
}
.value.zero {
  color: var(--color-text-muted);
}
.reset {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  flex: none;
  padding: 0;
  font-size: 0.9rem;
  line-height: 1;
  cursor: pointer;
}
.reset:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.reset:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
