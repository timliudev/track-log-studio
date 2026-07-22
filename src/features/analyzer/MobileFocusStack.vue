<script setup lang="ts">
/**
 * F1 phase 1 — the mobile "Focus Stack": a short, curated vertical split of
 * the visible cards (RaceChrono-style, e.g. map on top / chart below) shown
 * INSTEAD of the full single-column grid when the mobile view mode is
 * `focus`. It reuses the exact same card content as the grid — each panel is
 * a slim header (title + an "expand to full" affordance) over
 * <AnalyzerCardBody>, WITHOUT any grid drag/resize/gutter chrome (which is
 * what lets it sidestep the B61/B102 gesture races, see the design doc §7).
 *
 * AnalyzerView stays the single source that computes the visible, ordered id
 * set (`ids`) and the per-panel height weight (`weightFor`, from
 * useMobileView) — this component only lays them out. Phase 1 uses fixed
 * proportional weights (no draggable divider yet — that's phase 2); panels
 * flex-grow by weight to fill the viewport, and the stack scrolls as a whole
 * once the curated set is taller than one screen (each panel keeping a
 * sensible minimum height), while lists that already scroll internally (the
 * lap table) keep doing so inside their own body.
 */
import { useI18n } from 'vue-i18n'
import type { AnalyzerCardContext } from './analyzerCardContext'
import AnalyzerCardBody from './AnalyzerCardBody.vue'

defineProps<{
  /** Visible card ids in focus-stack order (AnalyzerView derives this from
   *  useMobileView().focusStackIds over the mobile visible set). */
  ids: string[]
  /** The shared card wiring harness passed straight down to every body. */
  ctx: AnalyzerCardContext
  /** Card title resolver (AnalyzerView's titleForItemId). */
  titleFor: (id: string) => string
  /** Per-panel flex-grow weight (AnalyzerView wires this to
   *  useMobileView().weightFor with a sensible per-card default). */
  weightFor: (id: string) => number
}>()

const emit = defineEmits<{
  /** The user tapped a panel's "expand to full" affordance — AnalyzerView
   *  switches the mobile view mode back to the full dashboard. */
  expand: []
}>()

const { t } = useI18n()
</script>

<template>
  <div class="focus-stack">
    <section
      v-for="id in ids"
      :key="id"
      class="focus-panel"
      :style="{ flexGrow: weightFor(id) }"
      :data-card-id="id"
    >
      <header class="focus-panel-header">
        <span class="focus-panel-title">{{ titleFor(id) }}</span>
        <button
          type="button"
          class="focus-expand"
          :title="t('analyzer.mobileView.expandToFull')"
          :aria-label="t('analyzer.mobileView.expandToFull')"
          @click="emit('expand')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </header>
      <div class="focus-panel-body">
        <AnalyzerCardBody :id="id" :ctx="ctx" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.focus-stack {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 1.5);
  /* Fill the height AnalyzerView's `.analyzer.focus-mode` hands us (the space
     between the toolbar and BottomNav) and scroll as a whole when the curated
     set is taller than one screen. */
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.focus-panel {
  display: flex;
  flex-direction: column;
  /* min-height:0 lets the body's own scroll take over; the floor keeps a
     many-card stack legible (it scrolls the whole stack instead). */
  min-height: 180px;
  flex-basis: 0;
  flex-shrink: 1;
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  background: var(--color-surface);
  overflow: hidden;
}
.focus-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
}
.focus-panel-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-expand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  cursor: pointer;
}
.focus-expand svg {
  width: 16px;
  height: 16px;
}
.focus-expand:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.focus-panel-body {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow: auto;
}
</style>
