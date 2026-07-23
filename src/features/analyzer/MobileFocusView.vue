<script setup lang="ts">
/**
 * F5 phase 1 — the mobile "single-focus view": one full-screen visual at a
 * time, chosen via a top tab bar, REPLACING F1's Focus Stack (which stacked
 * several curated cards vertically — see docs/specs/F5-SINGLE-FOCUS-DESIGN.md
 * §1 for why: a tall curated stack still had to scroll, starved the phase-2
 * divider of room to rebalance, and pushed the scrubber off the bottom edge
 * on a many-card stack). Retires MobileFocusStack.vue's divider entirely —
 * there's nothing to divide when only one view renders at a time.
 *
 * AnalyzerView stays the single owner of the visible, ordered id set (`ids` —
 * same source F1's `focusStackIds` was) and of which one is currently shown
 * (`currentViewId`, from useMobileView) — this component only renders the tab
 * bar for that set and the one active body. Tapping a tab is a pure `select`
 * emit; AnalyzerView is the one that persists it (via
 * useMobileView().setCurrentView), same "dumb view, owning composable
 * persists" split MobileScrubber's `scrub` emit already uses for the cursor.
 *
 * Phase 1 is tap-only (§8 of the design doc) — left/right swipe across the
 * body to switch tabs is phase 2, deliberately deferred because it has to
 * arbitrate against the map's own pan and the charts' own zoom-pan gestures.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnalyzerCardContext } from './analyzerCardContext'
import AnalyzerCardBody from './AnalyzerCardBody.vue'

const props = defineProps<{
  /** Visible card ids in tab order (AnalyzerView's `focusStackIds` —
   *  unchanged from F1: the mobile visible set run through the user's
   *  explicit focus order). */
  ids: string[]
  /** The shared card wiring harness passed straight down to the active body. */
  ctx: AnalyzerCardContext
  /** Card title resolver (AnalyzerView's titleForItemId) — reused verbatim
   *  for tab labels, no new per-card strings needed. */
  titleFor: (id: string) => string
  /** The id AnalyzerView believes is currently selected (from
   *  useMobileView().currentViewId, already reconciled against `ids` there —
   *  but this component defends against a stale value anyway, see
   *  `activeId` below, since the two computeds can be one tick apart). */
  currentViewId: string
}>()

const emit = defineEmits<{
  /** The user tapped a tab — AnalyzerView persists this via
   *  useMobileView().setCurrentView. Emitted even when the tab is already
   *  active (a harmless same-reference no-op downstream, see mobileView.ts's
   *  `setCurrentView`), so this component never needs to know the current
   *  selection to decide whether to emit. */
  select: [id: string]
}>()

const { t } = useI18n()

/** The id to actually render: `currentViewId` if it's still one of `ids`,
 *  else the first id — defensive fallback for a currentViewId that's gone
 *  stale (a chart removed, a card hidden) between AnalyzerView's own
 *  reconciliation and this render, or simply unset (`''`) on first load. */
const activeId = computed<string>(() => {
  if (props.currentViewId && props.ids.includes(props.currentViewId)) return props.currentViewId
  return props.ids[0] ?? ''
})
</script>

<template>
  <div class="focus-view">
    <div
      v-if="ids.length > 0"
      class="focus-tabs"
      role="tablist"
      :aria-label="t('analyzer.mobileView.focusViewTabsAria')"
    >
      <button
        v-for="id in ids"
        :key="id"
        type="button"
        role="tab"
        class="focus-tab"
        :class="{ active: id === activeId }"
        :aria-selected="id === activeId"
        @click="emit('select', id)"
      >
        {{ titleFor(id) }}
      </button>
    </div>
    <div class="focus-view-body">
      <AnalyzerCardBody v-if="activeId" :id="activeId" :ctx="ctx" />
    </div>
  </div>
</template>

<style scoped>
.focus-view {
  display: flex;
  flex-direction: column;
  /* Fill the height AnalyzerView's `.analyzer.focus-mode` hands us (the space
     between the toolbar and BottomNav) — see that class's own comment,
     unchanged from F1. */
  flex: 1;
  min-height: 0;
}
.focus-tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 1px;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  background: var(--color-border);
}
.focus-tab {
  flex: 0 0 auto;
  /* Segmented-control language mirrored from AnalyzerView's `.xaxis` switch
     (design doc §7) — same colours, same active-state treatment — so the
     tab bar reads as the same kind of control as the rest of the toolbar. */
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 8px 14px;
  font: inherit;
  font-size: 0.9rem;
  white-space: nowrap;
  cursor: pointer;
}
.focus-tab.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
/* §8/B93 — coarse pointers get a real ≥44px tap target; the box itself grows
   (same direct-size-bump pattern as MobileFocusStack's old `.focus-expand`)
   rather than an invisible hit-slop overlay, since a tab's own
   border+background box already reads as its whole hit area. */
:root[data-any-pointer-coarse] .focus-tab {
  min-height: 44px;
}
.focus-view-body {
  flex: 1;
  min-height: 0;
  /* Lets the map's own fill layout and the lap table's internal scroll keep
     working unchanged — same rationale as F1's `.focus-panel-body`. */
  overflow: auto;
}
</style>
