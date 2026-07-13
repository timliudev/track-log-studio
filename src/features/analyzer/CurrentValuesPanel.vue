<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSession } from '@/domain/model/LogSession'
import { timeSeconds } from '@/domain/analysis/timeAxis'
import {
  resolveCurrentValueIndex,
  buildCurrentValueFields,
  formatCurrentValueField,
} from '@/domain/analysis/currentValues'
import CardFillScroll from '@/components/CardFillScroll.vue'

/**
 * B15/B16 — "目前數值" (current values) dashboard card: every channel in the
 * active session, plus the elapsed session time (B16 — time is just another
 * field), all read at the SAME shared sample index and laid out as an
 * auto-sizing grid of label+value tiles.
 *
 * That shared index is the analyzer's cursor (chart hover / map hover — see
 * analyzerStore's `cursorIdx`, forwarded here as `cursorIdx`) when one is
 * set, otherwise the session's last row — see currentValues.ts's
 * `resolveCurrentValueIndex` for why "last row" beats an all-dashes grid at
 * rest.
 *
 * Performance: `elapsedTimeSec` is its own `computed` keyed ONLY on
 * `session` (an O(rowCount) call to `timeSeconds`), so it is cached across
 * cursor moves; `fields` re-runs on every cursor move but only does an O(1)
 * array index per channel (see buildCurrentValueFields's doc) — never
 * re-scanning a whole channel's data.
 */
const props = defineProps<{
  session: LogSession | null
  cursorIdx: number | null
}>()

const { t } = useI18n()

const elapsedTimeSec = computed(() => (props.session ? timeSeconds(props.session) : null))

const index = computed(() =>
  props.session ? resolveCurrentValueIndex(props.cursorIdx, props.session.rowCount) : null,
)

const fields = computed(() => {
  const s = props.session
  const elapsed = elapsedTimeSec.value
  if (!s || !elapsed) return []
  return buildCurrentValueFields(s, elapsed, index.value, t('analyzer.currentValues.time'))
})
</script>

<template>
  <CardFillScroll class="current-values-panel">
    <p v-if="!session" class="hint">{{ t('analyzer.currentValues.noSession') }}</p>
    <div v-else class="values-grid">
      <div v-for="f in fields" :key="f.key" class="value-cell" :class="{ 'value-cell--time': f.kind === 'time' }">
        <span class="value-label" :title="f.label">{{ f.label }}</span>
        <span class="value-number">{{ formatCurrentValueField(f) }}</span>
      </div>
    </div>
  </CardFillScroll>
</template>

<style scoped>
.hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.values-grid {
  display: grid;
  /* B43 — `min(96px, 100%)` (rather than a bare `96px` floor) lets the track
     shrink below 96px when the card itself is resized narrower than that:
     a bare 96px floor would force a track wider than the available space,
     triggering a horizontal scrollbar instead of the single-column stack a
     narrow card should show. At >=96px-wide cards this is identical to the
     previous behaviour (min(96px, 100%) === 96px once 100% >= 96px). */
  grid-template-columns: repeat(auto-fill, minmax(min(96px, 100%), 1fr));
  gap: 8px;
  align-content: start;
}
.value-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--color-bg);
  min-width: 0;
}
.value-cell--time {
  outline: 1px solid var(--color-accent);
}
.value-label {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.value-number {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
