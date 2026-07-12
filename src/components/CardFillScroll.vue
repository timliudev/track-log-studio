<script setup lang="ts">
/**
 * B24 — shared "fill the card's remaining height, scroll internally" layout
 * primitive for a DashboardCard body's content.
 *
 * DashboardCard's own `.body` (see its module doc) is already a flex COLUMN
 * that fills the grid item's height and scrolls AS A WHOLE when its content
 * overflows — good for a single fill-height child (a chart/map), but wrong
 * for a card that mixes fixed-size controls (a search bar, a toggle row,
 * hints) with a growing list: the whole card scrolling means the controls
 * scroll out of view along with the list, and a long list is capped to
 * whatever arbitrary height it was given (the reported bug: the acceleration
 * test's result list was capped at a fixed 260px regardless of how tall the
 * card itself was resized to, see AccelTestPanel.vue before this change).
 *
 * This component splits that in two: an optional `header` slot (rendered at
 * its natural/auto height, never scrolls — controls, search/filter fields,
 * static hints) and a default slot that gets ALL the remaining vertical
 * space and scrolls INTERNALLY when its own content overflows. Composing
 * this from `flex: 1 1 auto; min-height: 0` at every level (this root, and
 * the content pane) is what makes the height cascade correctly from
 * DashboardCard's `.body` down to here — `min-height: 0` overrides a flex
 * item's default `min-height: auto`, which would otherwise let the content
 * pane grow past its flex-basis to fit its children instead of clipping/
 * scrolling them (the classic "flexbox won't let children shrink" trap).
 *
 * Any card wanting "fixed controls + scrolling list" (accel test's result
 * list, B15's current-values grid, …) wraps its content in this rather than
 * hand-rolling the same flex/overflow rules per component.
 */
</script>

<template>
  <div class="card-fill-scroll">
    <div v-if="$slots.header" class="card-fill-scroll__header">
      <slot name="header" />
    </div>
    <div class="card-fill-scroll__content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.card-fill-scroll {
  display: flex;
  flex-direction: column;
  /* Fill whatever height the host gives this (DashboardCard's `.body`, a flex
     column itself — see that component's #T1 note) rather than sizing to
     content, so the content pane below has real remaining space to scroll
     within instead of the whole card growing/scrolling. */
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  gap: calc(var(--space) * 0.75);
}
.card-fill-scroll__header {
  flex: 0 0 auto;
  /* Header content is typically several stacked rows (toggles, fields,
     hints) — lay them out the same flex-column-with-gap way the root does,
     rather than leaving multiple direct children to plain block-flow (no
     gap) once they're wrapped in this extra div. */
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 0.75);
}
.card-fill-scroll__content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>
