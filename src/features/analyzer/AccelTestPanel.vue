<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AccelSegment } from '@/domain/analysis/accelTest'
import type { AccelCondition } from '@/stores/analyzerStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { formatLapTime } from '@/domain/analysis/format'

const props = defineProps<{
  /** EVERY matching segment for the current condition, in chronological order
   *  (one flagged `isFastest`), or an empty array when nothing qualifies (see
   *  AnalyzerView's accelResults computed for the search call). Distinguished
   *  from "not computed yet" (below) by `speedAvailable`. */
  results: AccelSegment[]
  /** Whether the search even ran (speed channel + session present). */
  speedAvailable: boolean
}>()

const emit = defineEmits<{
  /** User asked to focus the found segment (zoom the charts/map to it). */
  focus: [segment: AccelSegment]
  /** User asked to cancel the current focus (B26) — restore the full view. */
  clear: []
}>()

const { t } = useI18n()
const analyzer = useAnalyzerStore()

// B26: a found segment can be "focused" (zooms the charts/map to its span —
// see AnalyzerView's onAccelFocus), but there was previously no way back out
// short of manually re-zooming. `focusedKey` tracks which segment (by its
// `startIdx-endIdx` key, same as the list's `:key`) is currently focused so
// the row can render a highlight + toggle its own button, and so a global
// "clear focus" affordance can appear.
const focusedKey = ref<string | null>(null)

function segKey(seg: AccelSegment): string {
  return `${seg.startIdx}-${seg.endIdx}`
}

function isFocused(seg: AccelSegment): boolean {
  return focusedKey.value === segKey(seg)
}

/** Row click / focus-button click: toggles — clicking the already-focused
 *  segment again cancels the focus instead of re-emitting the same zoom. */
function onFocusClick(seg: AccelSegment): void {
  if (isFocused(seg)) {
    clearFocus()
    return
  }
  focusedKey.value = segKey(seg)
  emit('focus', seg)
}

function clearFocus(): void {
  if (focusedKey.value == null) return
  focusedKey.value = null
  emit('clear')
}

// The result list changes (condition edited, new session, …) whenever a
// fresh search runs — any previously-focused segment may no longer exist in
// the new array, so drop the stale focus rather than leave the chart zoomed
// to a span that no longer corresponds to a listed result.
watch(
  () => props.results,
  () => clearFocus(),
)

const condition = computed(() => analyzer.accelCondition)
const isDistance = computed(() => condition.value.kind === 'distance')

function setKind(kind: AccelCondition['kind']): void {
  if (kind === condition.value.kind) return
  analyzer.setAccelCondition(
    kind === 'distance'
      ? { kind: 'distance', distanceM: 100, entrySpeedKmh: 0 }
      : { kind: 'speed', fromKmh: 0, toKmh: 100 },
  )
}

function onDistanceInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (condition.value.kind !== 'distance') return
  analyzer.setAccelCondition({ ...condition.value, distanceM: Number.isFinite(v) && v > 0 ? v : 0 })
}

function onEntrySpeedInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (condition.value.kind !== 'distance') return
  analyzer.setAccelCondition({ ...condition.value, entrySpeedKmh: Number.isFinite(v) && v >= 0 ? v : 0 })
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
        <span>{{ t('analyzer.accelEntrySpeed') }}</span>
        <input
          type="number"
          inputmode="decimal"
          min="0"
          step="1"
          :value="condition.entrySpeedKmh"
          @input="onEntrySpeedInput"
        />
      </label>
      <p class="hint entry-speed-hint">{{ t('analyzer.accelEntrySpeedHint') }}</p>
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
    <p v-else-if="props.results.length === 0" class="hint">{{ t('analyzer.accelNoMatch') }}</p>
    <template v-else>
      <div class="row result-count-row">
        <p class="hint result-count">{{ t('analyzer.accelResultCount', { n: props.results.length }) }}</p>
        <button
          v-if="focusedKey != null"
          type="button"
          class="clear-focus-btn"
          @click="clearFocus"
        >
          {{ t('analyzer.accelClearFocus') }}
        </button>
      </div>
      <ul class="result-list">
        <li
          v-for="(seg, i) in props.results"
          :key="`${seg.startIdx}-${seg.endIdx}`"
          class="result"
          :class="{ fastest: seg.isFastest, focused: isFocused(seg) }"
        >
          <span class="result-index">#{{ i + 1 }}</span>
          <span v-if="seg.isFastest" class="fastest-badge" :title="t('analyzer.accelFastest')">⚡</span>
          <span class="result-time">{{ formatLapTime(seg.timeMs) }}</span>
          <span class="result-detail">{{ fmtDist(seg.distanceM) }}</span>
          <span class="result-detail">
            {{ t('analyzer.accelEntryExit', {
              entry: fmtSpeed(seg.entrySpeedKmh),
              exit: fmtSpeed(seg.exitSpeedKmh),
            }) }}
          </span>
          <button type="button" class="focus-btn" :class="{ active: isFocused(seg) }" @click="onFocusClick(seg)">
            {{ isFocused(seg) ? t('analyzer.accelUnfocus') : t('analyzer.accelFocus') }}
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.accel-test-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
.entry-speed-hint {
  flex-basis: 100%;
  font-size: 0.78rem;
  opacity: 0.8;
}
.result-count-row {
  justify-content: space-between;
  flex-wrap: nowrap;
}
.result-count {
  margin-bottom: -2px;
}
.clear-focus-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.85rem;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
  white-space: nowrap;
}
.clear-focus-btn:hover {
  color: var(--color-accent);
}
.result-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
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
.result.fastest {
  outline: 1px solid var(--color-accent);
  background: var(--color-surface);
}
.result.focused {
  box-shadow: inset 3px 0 0 var(--color-accent);
}
.result-index {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  min-width: 1.6em;
}
.fastest-badge {
  line-height: 1;
}
.result-time {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}
.result.fastest .result-time {
  color: var(--color-accent);
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
.focus-btn.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-color: var(--color-accent);
}
</style>
