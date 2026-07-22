<script setup lang="ts">
/**
 * F2 — the grouped card add/remove/locate menu replacing B98's toolbar-only
 * add-chart buttons. A toolbar toggle button opens a popover listing every
 * STATIC card (grouped by function — see cardGroups.ts) plus a dedicated
 * "圖表" section listing every chart instance one-to-many (each with its own
 * 定位/delete, and an "＋新增圖表" row at the bottom calling the same
 * add-chart actions the old standalone toolbar buttons used).
 *
 * Presentation-only: AnalyzerView computes which cards are checked/locatable
 * (folding in the visibility store, structural rules, and the cvtDynamics
 * feature flag) and passes them down as plain data; this component only
 * renders rows and emits user intent (`toggle`/`locate`/`add-*`/`remove-chart`).
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

export interface CardMenuStaticEntry {
  id: string
  title: string
  /** Current visibility-store preference (data-default already folded in) —
   *  drives the row's checkbox. */
  checked: boolean
  /** Whether the card is ACTUALLY rendered right now (checked AND every
   *  structural/flag gate passes) — an unlocatable row's 定位 button is
   *  disabled rather than hidden, so the user can still see/toggle it. */
  locatable: boolean
}

export interface CardMenuGroup {
  id: string
  label: string
  items: CardMenuStaticEntry[]
}

export interface CardMenuChartEntry {
  /** The chart's own store id (for remove-chart / analyzerStore lookups). */
  id: number
  /** The chart's grid item id (chartItemId(id)) — what toggle/locate key off. */
  itemId: string
  title: string
  checked: boolean
  locatable: boolean
}

defineProps<{
  groups: CardMenuGroup[]
  charts: CardMenuChartEntry[]
  chartsGroupLabel: string
}>()

const emit = defineEmits<{
  toggle: [id: string, value: boolean]
  locate: [id: string]
  'add-timeseries': []
  'add-scatter': []
  'remove-chart': [chartId: number]
}>()

const { t } = useI18n()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

function onDocumentPointerDown(e: PointerEvent): void {
  if (!open.value) return
  const root = rootEl.value
  if (root && e.target instanceof Node && !root.contains(e.target)) open.value = false
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}
watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    document.removeEventListener('keydown', onKeydown)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
})

function onToggleInput(id: string, e: Event): void {
  emit('toggle', id, (e.target as HTMLInputElement).checked)
}
function onLocate(id: string, locatable: boolean): void {
  if (!locatable) return
  emit('locate', id)
  open.value = false
}
</script>

<template>
  <div ref="rootEl" class="card-menu">
    <button
      type="button"
      class="menu-toggle"
      :aria-expanded="open"
      aria-haspopup="true"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="7" height="7" rx="1.5" />
        <rect x="14" y="4" width="7" height="7" rx="1.5" />
        <rect x="3" y="15" width="7" height="5" rx="1.5" />
        <rect x="14" y="15" width="7" height="5" rx="1.5" />
      </svg>
      <span>{{ t('analyzer.cardMenu.button') }}</span>
    </button>

    <div v-if="open" class="popover" role="menu">
      <section v-for="group in groups" :key="group.id" class="group" role="group" :aria-label="group.label">
        <h3 class="group-heading">{{ group.label }}</h3>
        <div v-for="item in group.items" :key="item.id" class="row">
          <input
            :id="`card-menu-check-${item.id}`"
            type="checkbox"
            class="row-check"
            :checked="item.checked"
            @change="onToggleInput(item.id, $event)"
          />
          <label :for="`card-menu-check-${item.id}`" class="visually-hidden">{{
            t('analyzer.cardMenu.toggleAria', { name: item.title })
          }}</label>
          <button
            type="button"
            class="row-name"
            :disabled="!item.locatable"
            :title="item.locatable ? undefined : t('analyzer.cardMenu.notShownHint')"
            @click="onLocate(item.id, item.locatable)"
          >
            {{ item.title }}
          </button>
        </div>
      </section>

      <section class="group charts-group" role="group" :aria-label="chartsGroupLabel">
        <h3 class="group-heading">{{ chartsGroupLabel }}</h3>
        <p v-if="charts.length === 0" class="empty-hint">{{ t('analyzer.cardMenu.noCharts') }}</p>
        <div v-for="c in charts" :key="c.id" class="row">
          <input
            :id="`card-menu-check-${c.itemId}`"
            type="checkbox"
            class="row-check"
            :checked="c.checked"
            @change="onToggleInput(c.itemId, $event)"
          />
          <label :for="`card-menu-check-${c.itemId}`" class="visually-hidden">{{
            t('analyzer.cardMenu.toggleAria', { name: c.title })
          }}</label>
          <button
            type="button"
            class="row-name"
            :disabled="!c.locatable"
            :title="c.locatable ? undefined : t('analyzer.cardMenu.notShownHint')"
            @click="onLocate(c.itemId, c.locatable)"
          >
            {{ c.title }}
          </button>
          <button
            type="button"
            class="row-delete"
            :aria-label="t('analyzer.removeChart') + ' — ' + c.title"
            @click="emit('remove-chart', c.id)"
          >
            ✕
          </button>
        </div>
        <button type="button" class="add-row" @click="emit('add-timeseries')">
          ＋ {{ t('analyzer.addChart') }}
        </button>
        <button type="button" class="add-row" @click="emit('add-scatter')">
          ＋ {{ t('analyzer.addScatterChart') }}
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.card-menu {
  position: relative;
  display: inline-flex;
}
.menu-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.menu-toggle svg {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}
.menu-toggle:hover,
.menu-toggle[aria-expanded='true'] {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.popover {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  width: min(320px, calc(100vw - 32px));
  max-height: min(70vh, 560px);
  overflow-y: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  box-shadow: 0 8px 24px color-mix(in srgb, black 25%, transparent);
  padding: calc(var(--space) * 1.5);
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 1.5);
}

.group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.group + .group {
  padding-top: calc(var(--space) * 1.5);
  border-top: 1px solid var(--color-border);
}
.group-heading {
  margin: 0 0 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-muted);
}
.empty-hint {
  margin: 0 0 4px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}
.row-check {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  cursor: pointer;
}
.row-name {
  flex: 1 1 auto;
  min-width: 0;
  text-align: left;
  background: none;
  border: none;
  color: var(--color-text);
  font: inherit;
  padding: 4px 2px;
  cursor: pointer;
  border-radius: var(--radius);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-name:hover:not(:disabled) {
  color: var(--color-accent);
}
.row-name:disabled {
  color: var(--color-text-muted);
  cursor: default;
}
.row-delete {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius);
  color: var(--color-text-muted);
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}
.row-delete:hover {
  color: var(--color-danger, #e5484d);
  border-color: var(--color-border);
}
.add-row {
  margin-top: 4px;
  text-align: left;
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius);
  color: var(--color-text);
  font: inherit;
  padding: 6px 8px;
  cursor: pointer;
}
.add-row:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* §8 layer 3 touch-target policy (same convention as DashboardCard.vue's
   .icon-btn / AnalyzerView.vue's .grid-gutter) — any coarse pointer present
   grows the checkbox/name/delete row controls to a comfortable ≥44px tap
   target, done via padding/min-height rather than fixed box size so the
   text itself doesn't visually balloon. */
:root[data-any-pointer-coarse] .row {
  min-height: 44px;
}
:root[data-any-pointer-coarse] .row-check {
  width: 22px;
  height: 22px;
}
:root[data-any-pointer-coarse] .row-name {
  padding: 10px 4px;
}
:root[data-any-pointer-coarse] .row-delete {
  width: 44px;
  height: 44px;
}
</style>
