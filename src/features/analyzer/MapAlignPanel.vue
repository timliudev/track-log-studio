<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLapStore } from '@/stores/lapStore'
import { lapColor } from './lapColors'
import type { Lap } from '@/domain/model/Lap'

// Selected laps in colour order; the panel shows when ≥2 are selected so their
// (possibly GNSS-drifted) racing lines can be nudged into alignment on the map.
const props = defineProps<{ selectedLaps: Lap[] }>()

const { t } = useI18n()
const lapStore = useLapStore()

// Nudge step in metres — fine enough for the few-metre GNSS drift this corrects.
const STEP = 0.5

/** Signed metre label, e.g. '+2.0', '−1.5', '0'. */
function fmt(v: number): string {
  if (v === 0) return '0'
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`
}

const anyOffset = computed(() =>
  props.selectedLaps.some((l) => {
    const o = lapStore.mapOffsetOf(l.index)
    return o.x !== 0 || o.y !== 0
  }),
)

// dx east+, dy north+ (metres). North is up on the map, so the ▲ button is +y.
function nudge(index: number, dx: number, dy: number): void {
  lapStore.nudgeMapOffset(index, dx * STEP, dy * STEP)
}

function resetAll(): void {
  props.selectedLaps.forEach((l) => lapStore.resetMapOffset(l.index))
}

function hasOffset(index: number): boolean {
  const o = lapStore.mapOffsetOf(index)
  return o.x !== 0 || o.y !== 0
}
</script>

<template>
  <section class="malign" :aria-label="t('analyzer.mapAlignTitle')">
    <div class="head">
      <span class="title">{{ t('analyzer.mapAlignTitle') }}</span>
      <button v-if="anyOffset" type="button" class="reset-all" @click="resetAll">
        {{ t('analyzer.alignResetAll') }}
      </button>
    </div>
    <p class="hint">{{ t('analyzer.mapAlignHint') }}</p>
    <ul class="rows">
      <li v-for="lap in selectedLaps" :key="lap.index" class="row">
        <span class="swatch" :style="{ background: lapColor(selectedLaps.indexOf(lap)) }" />
        <span class="name">#{{ lap.index + 1 }}</span>
        <div class="pad" role="group" :aria-label="t('analyzer.mapAlignTitle')">
          <button
            type="button"
            class="up"
            :title="t('analyzer.mapNorth')"
            :aria-label="t('analyzer.mapNorth')"
            @click="nudge(lap.index, 0, 1)"
          >
            ▲
          </button>
          <button
            type="button"
            class="left"
            :title="t('analyzer.mapWest')"
            :aria-label="t('analyzer.mapWest')"
            @click="nudge(lap.index, -1, 0)"
          >
            ◀
          </button>
          <button
            type="button"
            class="right"
            :title="t('analyzer.mapEast')"
            :aria-label="t('analyzer.mapEast')"
            @click="nudge(lap.index, 1, 0)"
          >
            ▶
          </button>
          <button
            type="button"
            class="down"
            :title="t('analyzer.mapSouth')"
            :aria-label="t('analyzer.mapSouth')"
            @click="nudge(lap.index, 0, -1)"
          >
            ▼
          </button>
        </div>
        <span class="value">
          ↔ {{ fmt(lapStore.mapOffsetOf(lap.index).x) }} · ↕ {{ fmt(lapStore.mapOffsetOf(lap.index).y) }} m
        </span>
        <button
          type="button"
          class="reset"
          :disabled="!hasOffset(lap.index)"
          :title="t('analyzer.mapAlignResetLap')"
          :aria-label="t('analyzer.mapAlignResetLap')"
          @click="lapStore.resetMapOffset(lap.index)"
        >
          ↺
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.malign {
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
  gap: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
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
/* Compact 3×3 d-pad: arrows on the cross, centre empty. */
.pad {
  display: grid;
  grid-template-columns: repeat(3, 28px);
  grid-template-rows: repeat(3, 26px);
  gap: 2px;
  flex: none;
}
.pad button {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 0;
  font-size: 0.8rem;
  line-height: 1;
  cursor: pointer;
}
.pad button:hover {
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-color: var(--color-accent);
}
.pad .up {
  grid-area: 1 / 2;
}
.pad .left {
  grid-area: 2 / 1;
}
.pad .right {
  grid-area: 2 / 3;
}
.pad .down {
  grid-area: 3 / 2;
}
.value {
  min-width: 9em;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
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
