<script setup lang="ts">
/**
 * #8 — one grid item's visual chrome on the analyzer dashboard: a header bar
 * (title + optional extra actions in the `actions` slot) that is the ONLY
 * drag handle for its GridItem (see AnalyzerView's `drag-handle` class wired
 * into GridLayout's `dragAllowFrom`), and a scrollable body below it that
 * fills the remaining grid-item height — so content taller than the card
 * (e.g. the lap table) scrolls internally instead of pushing the grid item's
 * own height around.
 *
 * Content interactions (canvas pan/zoom, table row clicks, form inputs, …)
 * must NOT start a drag — restricting the draggable region to this header
 * (rather than the whole card) is what makes that possible without each
 * child component needing to know about the grid at all.
 */
defineProps<{
  title: string
}>()
</script>

<template>
  <div class="dashboard-card">
    <header class="drag-handle">
      <span class="title">{{ title }}</span>
      <span class="actions"><slot name="actions" /></span>
    </header>
    <div class="body">
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
.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: calc(var(--space) * 1.5);
}
</style>
