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
 *
 * B133 — the header slot used to have no height ceiling at all: `flex: 0 0
 * auto` lets it grow to whatever its content's natural height is, and
 * `.card-fill-scroll__content` (`flex: 1 1 auto; min-height: 0`) simply
 * absorbs whatever's left, INCLUDING zero. Sector Panel's theoretical-best-
 * lap summary (B47) put a per-sector `<li>` list in `#header` on the
 * assumption sector counts stay in the single digits; a large-circuit
 * auto-detect can produce ~100+ gates, so that list's natural height alone
 * swallowed the whole card and the content pane's gate list/remove buttons
 * disappeared completely (unreachable, not just visually cramped). This is a
 * defect in this SHARED component, not just that one caller — any header
 * that can grow unboundedly (a list whose length depends on data, not a
 * fixed set of controls) can starve the content pane the same way. Fixed by
 * capping the header at half the available height (`max-height: 50%` +
 * `overflow-y: auto`) so the content pane is GUARANTEED at least the other
 * half, no matter how tall the header's own content wants to be — the header
 * scrolls internally past that point instead of pushing content out.
 * Verified against every current caller (AccelTestPanel, CurrentValuesPanel,
 * SectorPanel): each header is a bounded set of controls (toggles/fields/a
 * short hint), never a per-data-row list, so none of them come close to 50%
 * in normal use — SectorPanel additionally caps its own unbounded gate-count
 * list (`.optimal-sectors`, see that component) so its header rarely needs
 * this fallback either; this rule exists as the belt to that suspenders for
 * any future caller that doesn't self-limit as carefully.
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
  /* B133 — guarantee the content pane below always keeps at least half the
     card's height: without a ceiling here, a header whose natural height
     grows with data (rather than staying a fixed set of controls) can eat
     the entire card and squeeze `.card-fill-scroll__content` to 0 (its
     `min-height: 0` means it has no floor to fall back on). Past this cap
     the header scrolls internally instead of continuing to grow. See the
     module doc above for the incident this fixes. */
  max-height: 50%;
  overflow-y: auto;
}
.card-fill-scroll__content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>
