<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * #8/#9 — one grid item's visual chrome on the analyzer dashboard: a header
 * bar (title + collapse/pin toggles + optional extra actions in the
 * `actions` slot) that is the ONLY drag handle for its GridItem (see
 * AnalyzerView's `drag-handle` class wired into GridLayout's
 * `dragAllowFrom`), and a scrollable body below it that fills the remaining
 * grid-item height — so content taller than the card (e.g. the lap table)
 * scrolls internally instead of pushing the grid item's own height around.
 *
 * Content interactions (canvas pan/zoom, table row clicks, form inputs, …)
 * must NOT start a drag — restricting the draggable region to this header
 * (rather than the whole card) is what makes that possible without each
 * child component needing to know about the grid at all.
 *
 * #9 — collapse (chevron) hides the BODY only, at every breakpoint, while
 * leaving the card's own grid slot (x/y/w/h) untouched: the alternative
 * (shrinking the GridItem's own `h` to a header-height value) would need to
 * remember + restore a "pre-collapse height" and would fight grid-layout-
 * plus's own vertical-compaction pass moving OTHER items into the reclaimed
 * space on every collapse/expand — body-hide sidesteps both problems.
 *
 * 釘選 (pin) — redesigned to work at BOTH breakpoints (previously mobile-only,
 * CSS `position: sticky`, which only worked because mobile's single-column
 * layout is normal document flow; desktop's grid items are absolutely
 * positioned via CSS transforms, where `position: sticky` does nothing).
 * Pin is now purely a "which card is this" flag: `pinned` only drives this
 * component's OWN chrome (button active-state, `.pinned` size/shadow
 * styling) — the actual sticky-while-scrolling behaviour lives one level up,
 * in AnalyzerView, which Teleports a pinned card's markup out of the grid
 * into a single sticky anchor and leaves an empty placeholder in the card's
 * original grid slot (so the layout doesn't jump). This component has no
 * idea whether it's currently rendering inside the grid or inside that
 * anchor — same props/emits either way, which is what makes the Teleport
 * possible without DashboardCard itself changing. Only one card may be
 * pinned at a time (enforced by panelState.ts's togglePinned, documented via
 * the pin button's own tooltip) rather than supporting a multi-pin stack.
 */
const props = defineProps<{
  title: string
  collapsed?: boolean
  pinned?: boolean
  /** #18 fix — the card's own grid slot width/height RATIO (in grid units,
   *  i.e. `layout item.w / item.h`), used ONLY while `pinned` to size the
   *  floating card so it keeps roughly the same shape it had in the grid
   *  instead of every pinned card being squashed into the same fixed
   *  `max-height: 45vh` regardless of whether it was originally short-and-
   *  wide (a control panel) or tall-and-narrow (a chart). Optional: when
   *  omitted (or not finite), falls back to the old fixed-height behaviour —
   *  see the `.pinned` CSS below. */
  aspectRatio?: number
}>()

const emit = defineEmits<{
  (e: 'update:collapsed', value: boolean): void
  (e: 'update:pinned', value: boolean): void
}>()

const { t } = useI18n()

// Only feed a POSITIVE finite ratio through to CSS — an unset/zero/NaN
// aspectRatio (e.g. a card whose layout entry momentarily has h:0) must not
// produce an invalid `aspect-ratio: NaN` or a divide-by-zero shape.
const cardStyle = computed(() =>
  props.pinned && props.aspectRatio != null && Number.isFinite(props.aspectRatio) && props.aspectRatio > 0
    ? { aspectRatio: String(props.aspectRatio) }
    : undefined,
)

function onToggleCollapsed(): void {
  emit('update:collapsed', !props.collapsed)
}
function onTogglePinned(): void {
  emit('update:pinned', !props.pinned)
}
</script>

<template>
  <div class="dashboard-card" :class="{ pinned, collapsed }" :style="cardStyle">
    <header class="drag-handle">
      <span class="title">{{ title }}</span>
      <span class="actions">
        <slot name="actions" />
        <button
          type="button"
          class="icon-btn pin-btn"
          :class="{ active: pinned }"
          v-tooltip="pinned ? t('analyzer.layout.unpin') : t('analyzer.layout.pin')"
          :aria-label="pinned ? t('analyzer.layout.unpin') : t('analyzer.layout.pin')"
          :aria-pressed="pinned"
          @click="onTogglePinned"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 17v5" />
            <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
          </svg>
        </button>
        <button
          type="button"
          class="icon-btn collapse-btn"
          :class="{ collapsed }"
          v-tooltip="collapsed ? t('analyzer.layout.expand') : t('analyzer.layout.collapse')"
          :aria-label="collapsed ? t('analyzer.layout.expand') : t('analyzer.layout.collapse')"
          :aria-expanded="!collapsed"
          @click="onToggleCollapsed"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </span>
    </header>
    <div v-if="!collapsed" class="body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.dashboard-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  overflow: hidden;
}
/* Collapsed: shrink the card itself to just its header. On desktop the
   GridItem slot (h) is untouched (see module doc), so this leaves the page
   background visible below the card within that slot rather than resizing
   the grid — acceptable and simple; the slot reclaims its full size again
   the moment the card is expanded or the layout is reset. On mobile's plain
   single-column flow there is no fixed-height ancestor, so this simply
   makes the card (and the vertical space it takes in the column) shrink for
   real. */
.dashboard-card.collapsed {
  height: auto;
}
.drag-handle {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px calc(var(--space) * 1.5);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
  cursor: move;
  /* Prevent the browser's own touch scroll/select from fighting the grid's
     own pointer-based drag handling on touch devices (desktop-only feature,
     but harmless to set unconditionally). */
  touch-action: none;
  user-select: none;
}
.dashboard-card.collapsed .drag-handle {
  border-bottom: none;
}
.title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  /* Actions (e.g. a chart's own remove button lives in its body, not here —
     this slot is for card-level chrome only) shouldn't inherit the header's
     drag behaviour. */
  cursor: default;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius);
  color: var(--color-text-muted);
  cursor: pointer;
  /* Buttons live inside the drag-handle header, which sets touch-action:none
     for the grid's own drag gesture — undo that here so tapping a button on
     a touch device isn't swallowed by the drag handler. */
  touch-action: manipulation;
}
.icon-btn svg {
  width: 16px;
  height: 16px;
}
.icon-btn:hover {
  color: var(--color-text);
  border-color: var(--color-border);
}
.pin-btn.active {
  color: var(--color-accent);
}
.collapse-btn svg {
  transition: transform 0.15s ease;
}
.collapse-btn.collapsed svg {
  transform: rotate(-90deg);
}
.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: calc(var(--space) * 1.5);
  /* T1 — the body is a flex COLUMN so a fill-height chart/map child can take
     `flex: 1 1 auto` (the remaining space) while its sibling text rows
     (legend/hints/inputs) keep their natural height and stay VISIBLE at any
     card size. Previously the chart claimed `height: 100%` OF THE BODY and
     pushed every text row below the fold, where `overflow: auto` hid it
     unless the user thought to scroll — and growing the window only widened
     the chart, never revealed the text. Non-fill cards are unaffected: block
     children simply become full-width column flex items with auto height. */
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

/* 釘選 (pin) chrome: the STICKY positioning itself now lives on AnalyzerView's
   pinned-card anchor (see its module doc) — a pinned card's markup is
   Teleported there, so this class only needs to bound its own size/shape
   once it's inside that anchor (an unbounded body could otherwise grow to
   dominate the screen) and add a visual "floating" cue. Applies identically
   at both breakpoints now.
   #18 fix — `aspect-ratio` (set inline via `cardStyle`, from the card's own
   grid w/h ratio) now drives the card's HEIGHT from its width, so a pinned
   card keeps roughly the shape it had in the grid instead of every pinned
   card — short control panel or tall chart alike — being squashed into the
   exact same 45vh box. `max-height: 45vh` stays as a SAFETY CEILING (a very
   tall/narrow card's aspect-ratio-derived height could otherwise still push
   past a comfortable viewport share) rather than the primary sizing rule;
   when `aspectRatio` isn't supplied, this falls back to the old behaviour
   unchanged. */
.dashboard-card.pinned {
  /* Override the base rule's `height: 100%` — that fills the (100%-height)
     GRID slot the un-pinned card normally lives in, but the pinned anchor
     it's Teleported into has no fixed height of its own, and `height: 100%`
     would otherwise WIN over `aspect-ratio` (a percentage height is a used
     value the aspect-ratio calculation must respect, not override) and
     silently defeat the whole fix above. */
  height: auto;
  max-height: 45vh;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
}
.dashboard-card.pinned .body {
  /* Cap the body so the whole sticky card respects max-height instead of
     overflowing it — the header stays fixed-size, the body scrolls/clips
     internally beyond that (TrackMap's own fillHeight mode already fills
     whatever height its host gives it, verified against this constraint). */
  min-height: 0;
}
</style>
