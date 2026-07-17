<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSession } from '@/domain/model/LogSession'
import { timeSeconds } from '@/domain/analysis/timeAxis'
import {
  resolveCurrentValueIndex,
  buildCurrentValueFields,
  formatCurrentValueField,
  type CurrentValueField,
} from '@/domain/analysis/currentValues'
import {
  arrangeCurrentValueFields,
  currentValuesEditableFields,
  type CurrentValuesSortMode,
} from '@/domain/analysis/currentValuesFieldPrefs'
import { useCurrentValuesFieldPrefs } from '@/composables/useCurrentValuesFieldPrefs'
import { cachedSessionChannelUpdateRates } from '@/composables/channelUpdateRateCache'
import CardFillScroll from '@/components/CardFillScroll.vue'

const GPS_UPDATE_RATE_KEY = '__updateRateGps'
const ECU_UPDATE_RATE_KEY = '__updateRateEcu'

/**
 * B15/B16 — "目前數值" (current values) dashboard card: every channel in the
 * active session, plus the elapsed session time (B16 — time is just another
 * field), all read at the SAME shared sample index and laid out as an
 * auto-sizing grid of label+value tiles.
 *
 * That shared index is the analyzer's cursor (chart hover / map hover — see
 * analyzerStore's `cursorIdx`) when one is set, otherwise the session's last
 * row — see currentValues.ts's `resolveCurrentValueIndex` for why "last row"
 * beats an all-dashes grid at rest.
 *
 * Performance: `elapsedTimeSec` is its own `computed` keyed ONLY on
 * `session` (an O(rowCount) call to `timeSeconds`), so it is cached across
 * cursor moves; `fields` re-runs on every cursor move but only does an O(1)
 * array index per channel (see buildCurrentValueFields's doc) — never
 * re-scanning a whole channel's data.
 *
 * B49 — field arrangement: the user can pick a sort mode (original channel
 * order / alphabetical / a manually-arranged custom order), hide individual
 * channels, and (in custom mode) reorder via an "edit fields" mode toggled
 * in the header — see `currentValuesFieldPrefs.ts` for the persisted-prefs
 * shape and pure sort/filter/reorder logic, and `useCurrentValuesFieldPrefs`
 * for the localStorage-backed composable. The synthetic "目前時間" field is
 * always first and can neither be hidden nor moved (B16/B49).
 */
const props = defineProps<{
  session: LogSession | null
  cursorIdx: number | null
}>()

const { t } = useI18n()

const elapsedTimeSec = computed(() => (props.session ? timeSeconds(props.session) : null))

// Keyed only by the session/file identity. The cache scans each raw channel
// once; cursor movement below only indexes values and reads these map entries.
const updateRates = computed(() => (props.session ? cachedSessionChannelUpdateRates(props.session) : null))

const index = computed(() =>
  props.session ? resolveCurrentValueIndex(props.cursorIdx, props.session.rowCount) : null,
)

const fields = computed<CurrentValueField[]>(() => {
  const s = props.session
  const elapsed = elapsedTimeSec.value
  if (!s || !elapsed) return []
  const built = buildCurrentValueFields(s, elapsed, index.value, t('analyzer.currentValues.time'))
  const rates = updateRates.value
  built.splice(
    1,
    0,
    {
      key: GPS_UPDATE_RATE_KEY,
      label: t('analyzer.currentValues.gpsUpdateRate'),
      kind: 'updateRate',
      value: rates?.gpsHz ?? NaN,
    },
    {
      key: ECU_UPDATE_RATE_KEY,
      label: t('analyzer.currentValues.ecuUpdateRate'),
      kind: 'updateRate',
      value: rates?.ecuHz ?? NaN,
    },
  )
  return built
})

const timeField = computed(() => fields.value.find((f) => f.kind === 'time') ?? null)

// The session's non-time channel keys, in the session's own order — the
// reconciliation key for the persisted prefs (see useCurrentValuesFieldPrefs's
// doc): whenever the loaded session changes, hidden/order entries for
// channels that no longer exist are dropped and any brand-new channel is
// appended at the end.
const channelKeys = computed(() => fields.value.filter((f) => f.kind !== 'time').map((f) => f.key))

const { prefs, setSortMode, toggleFieldHidden, moveFieldUp, moveFieldDown } =
  useCurrentValuesFieldPrefs(channelKeys)

/** B49 — "編輯欄位" mode: shows every field (including currently-hidden ones,
 *  so they can be brought back — the task's explicit requirement) with a
 *  show/hide checkbox per row, plus up/down reorder buttons when the active
 *  sort mode is 'custom'. Off by default so the grid stays "clean" (no extra
 *  chrome) for normal at-a-glance use. */
const editing = ref(false)

/** The edit-mode list's current order — only meaningful (and only rendered
 *  with move buttons, see the template's `sortMode === 'custom'` guard) once
 *  `sortMode` is 'custom', at which point this IS `prefs.order` filtered to
 *  what's actually present. Used to disable the button at either end of the
 *  list. */
const editableKeysInOrder = computed(() =>
  currentValuesEditableFields(fields.value, prefs.value).map((f) => f.key),
)
function isFirstEditable(key: string): boolean {
  return editableKeysInOrder.value[0] === key
}
function isLastEditable(key: string): boolean {
  const arr = editableKeysInOrder.value
  return arr.length > 0 && arr[arr.length - 1] === key
}

function isHidden(key: string): boolean {
  return prefs.value.hidden.includes(key)
}

/** All non-time channels hidden (and at least one exists) — the normal-mode
 *  grid would otherwise show only the time cell with no hint as to why. */
const allHidden = computed(
  () => channelKeys.value.length > 0 && channelKeys.value.every((k) => prefs.value.hidden.includes(k)),
)

/** The fields actually rendered: in edit mode, every field (hidden included)
 *  in the edit-mode order; otherwise the normal display arrangement (hidden
 *  filtered, ordered per the active sortMode) — time field always first in
 *  both. */
const visibleFields = computed<CurrentValueField[]>(() => {
  if (editing.value) {
    const editable = currentValuesEditableFields(fields.value, prefs.value)
    return timeField.value ? [timeField.value, ...editable] : editable
  }
  return arrangeCurrentValueFields(fields.value, prefs.value)
})

/** B44 — pre-format once per render (rather than in the template, where every
 *  cell would call `formatCurrentValueField` again just to render text) so
 *  the SAME string used to decide "did the displayed value actually change"
 *  is exactly what's on screen — comparing formatted text (not raw numbers)
 *  is deliberate: it's what "changed" means to the user (e.g. a value that
 *  rounds to the same displayed digits shouldn't pulse). */
function formatRateBadge(rate: number | null | undefined): string {
  return rate != null && Number.isFinite(rate) ? `${rate.toFixed(1)} Hz` : '— Hz'
}

const displayFields = computed(() => visibleFields.value.map((f) => ({
  ...f,
  text: formatCurrentValueField(f),
  rateBadge: f.kind === 'channel'
    ? formatRateBadge(updateRates.value?.byChannel.get(f.key))
    : null,
})))

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

function pulseMany(keys: readonly string[]): void {
  const elements = keys.map((key) => cellEls.get(key)).filter((el): el is HTMLElement => el != null)
  if (elements.length === 0) return
  for (const el of elements) el.classList.remove('value-cell--pulse')
  // Removing every class first and forcing ONE layout flush restarts all
  // affected animations together. The previous per-cell offsetWidth read
  // interleaved style writes and layout reads, producing one synchronous
  // reflow per changed channel on every cursor step.
  void elements[0].offsetWidth
  for (const el of elements) el.classList.add('value-cell--pulse')
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
    const changed: string[] = []
    for (const f of list) {
      const prev = lastText.get(f.key)
      if (f.kind !== 'time' && prev !== undefined && prev !== f.text) changed.push(f.key)
      lastText.set(f.key, f.text)
    }
    pulseMany(changed)
  },
  { flush: 'post', immediate: true },
)

const sortModes: CurrentValuesSortMode[] = ['original', 'alphabetical', 'custom']
function sortModeLabel(mode: CurrentValuesSortMode): string {
  return mode === 'original'
    ? t('analyzer.currentValues.sortOriginal')
    : mode === 'alphabetical'
      ? t('analyzer.currentValues.sortAlphabetical')
      : t('analyzer.currentValues.sortCustom')
}
</script>

<template>
  <CardFillScroll class="current-values-panel">
    <template v-if="session" #header>
      <div class="row edit-row">
        <button
          type="button"
          class="edit-toggle-btn"
          :class="{ active: editing }"
          @click="editing = !editing"
        >
          {{ editing ? t('analyzer.currentValues.doneEditing') : t('analyzer.currentValues.editFields') }}
        </button>
        <div
          v-if="editing"
          class="sort-mode-group"
          role="group"
          :aria-label="t('analyzer.currentValues.sortLabel')"
        >
          <button
            v-for="mode in sortModes"
            :key="mode"
            type="button"
            :class="{ active: prefs.sortMode === mode }"
            @click="setSortMode(mode)"
          >
            {{ sortModeLabel(mode) }}
          </button>
        </div>
      </div>
    </template>

    <p v-if="!session" class="hint">{{ t('analyzer.currentValues.noSession') }}</p>
    <template v-else>
      <div class="values-grid">
        <div
          v-for="f in displayFields"
          :key="f.key"
          :ref="(el) => setCellEl(f.key, el as Element | null)"
          class="value-cell"
          :class="{
            'value-cell--time': f.kind === 'time',
            'value-cell--hidden': editing && f.kind !== 'time' && isHidden(f.key),
            'value-cell--with-rate': f.rateBadge,
          }"
        >
          <span class="value-label" :title="f.label">{{ f.label }}</span>
          <span
            v-if="f.rateBadge"
            class="rate-badge"
            :title="t('analyzer.currentValues.channelUpdateRate', { rate: f.rateBadge })"
          >{{ f.rateBadge }}</span>
          <span class="value-number">{{ f.text }}</span>
          <div v-if="editing && f.kind !== 'time'" class="edit-controls">
            <label class="hide-toggle">
              <input
                type="checkbox"
                :checked="!isHidden(f.key)"
                :aria-label="
                  isHidden(f.key)
                    ? t('analyzer.currentValues.showField', { name: f.label })
                    : t('analyzer.currentValues.hideField', { name: f.label })
                "
                @change="toggleFieldHidden(f.key)"
              />
            </label>
            <div v-if="prefs.sortMode === 'custom'" class="move-buttons">
              <button
                type="button"
                class="move-btn"
                :disabled="isFirstEditable(f.key)"
                :aria-label="t('analyzer.currentValues.moveUp', { name: f.label })"
                @click="moveFieldUp(f.key)"
              >
                ▲
              </button>
              <button
                type="button"
                class="move-btn"
                :disabled="isLastEditable(f.key)"
                :aria-label="t('analyzer.currentValues.moveDown', { name: f.label })"
                @click="moveFieldDown(f.key)"
              >
                ▼
              </button>
            </div>
          </div>
        </div>
      </div>
      <p v-if="!editing && allHidden" class="hint">{{ t('analyzer.currentValues.allHidden') }}</p>
    </template>
  </CardFillScroll>
</template>

<style scoped>
.hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.edit-toggle-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  align-self: flex-start;
}
.edit-toggle-btn.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-color: var(--color-accent);
}
.sort-mode-group {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.sort-mode-group button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 5px 10px;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
  white-space: nowrap;
}
.sort-mode-group button.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.values-grid {
  display: grid;
  /* B43 — `min(96px, 100%)` (rather than a bare `96px` floor) lets the track
     shrink below 96px when the card itself is resized narrower than that:
     a bare 96px floor would force a track wider than the available space,
     triggering a horizontal scrollbar instead of the single-column stack a
     narrow card should show. At >=96px-wide cards this is identical to the
     previous behaviour (min(96px, 100%) === 96px once 100% >= 96px). B43b
     lowered the card's own minW grid-layout floor so this can actually be
     reached — see domain/layout/dashboardLayout.ts. */
  grid-template-columns: repeat(auto-fill, minmax(min(96px, 100%), 1fr));
  gap: 8px;
  align-content: start;
}
.value-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--color-bg);
  min-width: 0;
}
.value-cell--with-rate .value-label {
  padding-right: 42px;
}
.rate-badge {
  position: absolute;
  top: 7px;
  right: 8px;
  max-width: 42px;
  color: var(--color-text-muted);
  font-size: 0.62rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.value-cell--time {
  outline: 1px solid var(--color-accent);
}
/* B49 — a hidden field still listed in edit mode (so it can be checked back
   on) reads visibly de-emphasised rather than looking identical to a shown
   one. */
.value-cell--hidden {
  opacity: 0.5;
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
/* B49 — edit-mode per-cell controls (hide checkbox + custom-order up/down).
   Default sizes are comfortable for a mouse/trackpad; the
   `data-any-pointer-coarse` block below grows them to the >=44px touch
   target DESIGN.md §8's touch-friendly policy requires whenever ANY coarse
   pointer is present (not just on a narrow viewport — see theme.css's
   analogous rule for the grid resize handle). */
.edit-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-top: 2px;
}
.hide-toggle input {
  width: 18px;
  height: 18px;
  cursor: pointer;
}
.move-buttons {
  display: flex;
  gap: 2px;
}
.move-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  width: 24px;
  height: 24px;
  line-height: 1;
  font-size: 0.7rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.move-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.move-btn:not(:disabled):hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
:root[data-any-pointer-coarse] .current-values-panel .hide-toggle input,
:root[data-any-pointer-coarse] .current-values-panel .move-btn {
  width: 44px;
  height: 44px;
}
</style>
