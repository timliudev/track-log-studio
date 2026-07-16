<script setup lang="ts">
import LapExclusionIcon, { type LapExclusionReason } from './LapExclusionIcon.vue'
/**
 * The ⦸ manual-exclude toggle shared by every lap table's lead cell — the
 * primary LapTable.vue and every comparison recording's SessionLapComparison
 * table (B1c). Pulled out as its own component (rather than duplicated scoped
 * CSS in both SFCs) so the markup/styling/touch-target rules have exactly one
 * source of truth and can't drift between the two tables.
 *
 * The caller owns WHY: which store facet backs `excluded`/`disabled`/`label`
 * differs (lapStore.isExcluded/exclusionReason for the primary vs. the
 * per-session facet for a comparison) — this component only renders the
 * pressed/disabled visual state and bubbles the click.
 */
defineProps<{
  /** Whether this lap is currently excluded (any reason) — drives the "on" look. */
  excluded: boolean
  /** Whether the toggle is locked (auto-excluded by a band/sector rule the
   *  user can't override by hand while it still applies). */
  disabled: boolean
  /** Localized tooltip/aria-label text (include/exclude, or the reason it's locked). */
  label: string
  /** Which exclusion rule applies. A non-excluded row uses the manual icon as
   *  the familiar action affordance until the user excludes it. */
  reason?: LapExclusionReason | null
  sectorNumber?: number | null
}>()

const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    class="exclude"
    :class="{ on: excluded, 'auto-disabled': disabled }"
    v-tooltip="label"
    :aria-label="label"
    :aria-pressed="excluded"
    :aria-disabled="disabled"
    @click.stop="!disabled && emit('toggle')"
  >
    <LapExclusionIcon :reason="reason ?? 'manual'" :sector-number="sectorNumber" />
  </button>
</template>

<style scoped>
.exclude {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: 50%;
  width: 22px;
  height: 22px;
  flex: none;
  padding: 0;
  line-height: 1;
  cursor: pointer;
}
.exclude svg {
  display: block;
  width: 16px;
  height: 16px;
}
.exclude:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.exclude.on {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-bg);
}
/* Auto-excluded (band/sector rule) laps show the same "on" look so the ⦸
   state reads consistently, but muted + non-interactive cursor since the
   user can't toggle it off by hand while the rule still applies. */
.exclude.auto-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.exclude.auto-disabled:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
/* B35 — §8 layer 3: any coarse pointer present (useInputCapabilities.ts's
   capability signal mirrored onto <html data-any-pointer-coarse> — NOT a
   viewport-width guess, so a tablet running the full desktop layout gets
   this too) grows the ⦸ toggle to a comfortable >=44px touch target. */
:root[data-any-pointer-coarse] .exclude {
  width: 44px;
  height: 44px;
}
:root[data-any-pointer-coarse] .exclude svg {
  width: 22px;
  height: 22px;
}
</style>
