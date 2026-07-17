<script setup lang="ts">
import LapExclusionIcon, { type LapExclusionReason } from './LapExclusionIcon.vue'

/**
 * Shared manual exclusion control for laps and acceleration segments. Callers
 * own the underlying decision state and explanatory text; this component owns
 * the pressed, disabled, icon, and coarse-pointer target behaviour so the two
 * result lists cannot drift apart.
 */
withDefaults(defineProps<{
  excluded: boolean
  disabled?: boolean
  label: string
  /** Lap rows can use a reason-specific icon; other result types retain the
   * familiar manual-exclusion symbol. */
  reason?: LapExclusionReason | null
  sectorNumber?: number | null
}>(), {
  disabled: false,
  reason: null,
  sectorNumber: null,
})

const emit = defineEmits<{ toggle: [] }>()

// Kept as component values because happy-dom does not evaluate scoped media-like
// root selectors. CSS consumes both values below, which lets the component test
// verify the coarse target remains the §8-required 44px.
const compactToggleSize = '22px'
const coarseToggleSize = '44px'
const compactIconSize = '18px'
const coarseIconSize = '22px'
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
    :disabled="disabled"
    :style="{
      '--exclude-toggle-size': compactToggleSize,
      '--exclude-toggle-coarse-size': coarseToggleSize,
      '--exclude-icon-size': compactIconSize,
      '--exclude-icon-coarse-size': coarseIconSize,
    }"
    @click.stop="emit('toggle')"
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
  width: var(--exclude-toggle-size);
  height: var(--exclude-toggle-size);
  flex: none;
  padding: 0;
  line-height: 1;
  cursor: pointer;
  display: inline-grid;
  place-items: center;
}
.exclude svg {
  display: block;
  width: var(--exclude-icon-size);
  height: var(--exclude-icon-size);
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
.exclude.auto-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.exclude.auto-disabled:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
/* DESIGN.md §8: input density follows any coarse pointer, not viewport size. */
:root[data-any-pointer-coarse] .exclude {
  width: var(--exclude-toggle-coarse-size);
  height: var(--exclude-toggle-coarse-size);
}
:root[data-any-pointer-coarse] .exclude svg {
  width: var(--exclude-icon-coarse-size);
  height: var(--exclude-icon-coarse-size);
}
</style>
