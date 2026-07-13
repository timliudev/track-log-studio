<script setup lang="ts">
import { computed, watch } from 'vue'
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

/** B44 — pre-format once per render (rather than in the template, where every
 *  cell would call `formatCurrentValueField` again just to render text) so
 *  the SAME string used to decide "did the displayed value actually change"
 *  is exactly what's on screen — comparing formatted text (not raw numbers)
 *  is deliberate: it's what "changed" means to the user (e.g. a value that
 *  rounds to the same displayed digits shouldn't pulse). */
const displayFields = computed(() => fields.value.map((f) => ({ ...f, text: formatCurrentValueField(f) })))

/**
 * B44 — low-contrast "value changed" pulse: a brief background flash on any
 * cell whose DISPLAYED text differs from what it showed last render, so
 * scrubbing the shared cursor visibly highlights which channels just moved.
 * The "目前時間" cell is excluded (kind === 'time') — it changes on every
 * single render, so pulsing it would be meaningless noise.
 *
 * Implemented as a plain (non-reactive) `Map` of key -> last-shown text plus
 * direct DOM class manipulation, NOT a reactive ref keyed per cell: this is
 * pure imperative "flash and let CSS finish the fade" work, not state the
 * template needs to read back, so routing it through Vue's reactivity would
 * only add re-render churn for zero benefit. The remove → force-reflow → add
 * dance is the standard way to RESTART a CSS animation that's already
 * running — needed because rapidly scrubbing the cursor can change the same
 * cell's value on back-to-back renders, and the spec here is "restart, don't
 * stack" (a cell flashes at most once at a time, never accumulates layered
 * animations from several quick changes).
 */
const lastText = new Map<string, string>()
const cellEls = new Map<string, HTMLElement>()

function setCellEl(key: string, el: Element | null): void {
  if (el) cellEls.set(key, el as HTMLElement)
  else cellEls.delete(key)
}

function pulse(key: string): void {
  const el = cellEls.get(key)
  if (!el) return
  el.classList.remove('value-cell--pulse')
  // Force a reflow between remove/add so the browser treats the re-added
  // class as a NEW animation start rather than a no-op (same class, same
  // computed style) — see module doc above.
  void el.offsetWidth
  el.classList.add('value-cell--pulse')
}

// `flush: 'post'` — run after the DOM has the new cell elements/text so
// `cellEls` is populated and `pulse` can find them immediately. `immediate:
// true` seeds `lastText` from the very first render: without it, the watcher
// wouldn't run at all until displayFields changes a SECOND time, so the
// first-ever cursor move would (wrongly) compare against nothing and pulse
// every field.
watch(
  displayFields,
  (list) => {
    for (const f of list) {
      const prev = lastText.get(f.key)
      if (f.kind !== 'time' && prev !== undefined && prev !== f.text) pulse(f.key)
      lastText.set(f.key, f.text)
    }
  },
  { flush: 'post', immediate: true },
)
</script>

<template>
  <CardFillScroll class="current-values-panel">
    <p v-if="!session" class="hint">{{ t('analyzer.currentValues.noSession') }}</p>
    <div v-else class="values-grid">
      <div
        v-for="f in displayFields"
        :key="f.key"
        :ref="(el) => setCellEl(f.key, el as Element | null)"
        class="value-cell"
        :class="{ 'value-cell--time': f.kind === 'time' }"
      >
        <span class="value-label" :title="f.label">{{ f.label }}</span>
        <span class="value-number">{{ f.text }}</span>
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
/* B44 — low-contrast "value changed" pulse, see the `pulse()` doc above for
   why this is a plain CSS animation retriggered by a class toggle rather
   than a JS-driven per-frame effect. */
.value-cell--pulse {
  animation: value-cell-pulse 400ms ease-out;
}
@keyframes value-cell-pulse {
  from {
    background: color-mix(in srgb, var(--color-accent) 10%, var(--color-bg));
  }
  to {
    background: var(--color-bg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .value-cell--pulse {
    animation: none;
  }
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
