<script setup lang="ts">
import type { LapExclusionReason } from './LapExclusionIcon.vue'
import ExclusionToggle from './ExclusionToggle.vue'
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
  <ExclusionToggle
    :excluded="excluded"
    :disabled="disabled"
    :label="label"
    :reason="reason"
    :sector-number="sectorNumber"
    @toggle="emit('toggle')"
  />
</template>
