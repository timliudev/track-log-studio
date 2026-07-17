<script setup lang="ts">
import { computed } from 'vue'

export type LapExclusionReason = 'manual' | 'timeBand' | 'distBand' | 'sector'

const props = defineProps<{ reason: LapExclusionReason; sectorNumber?: number | null }>()

const hasSectorNumber = computed(() =>
  props.reason === 'sector' && Number.isInteger(props.sectorNumber) && (props.sectorNumber ?? 0) > 0,
)
const sectorLabel = computed(() => `S${props.sectorNumber}`)
const sectorFontSize = computed(() => (props.sectorNumber! >= 10 ? 6.75 : 8))
const sectorLetterSpacing = computed(() => (props.sectorNumber! >= 10 ? -0.45 : -0.15))
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="reason === 'manual'">
      <circle cx="12" cy="12" r="8" />
      <path d="M6.3 17.7 17.7 6.3" />
    </template>
    <template v-else-if="reason === 'timeBand'">
      <circle cx="12" cy="13" r="7" />
      <path d="M9 3h6M12 6v3l2 2M7 3h2M15 3h2" />
    </template>
    <template v-else-if="reason === 'distBand'">
      <path d="m5 17 12-12 2 2L7 19l-3-3Z" />
      <path d="m9 13 2 2m1-5 2 2m1-5 2 2" />
    </template>
    <template v-else-if="hasSectorNumber">
      <text
        class="sector-label"
        x="12"
        y="12"
        text-anchor="middle"
        dominant-baseline="central"
        fill="currentColor"
        stroke="none"
        :font-size="sectorFontSize"
        :letter-spacing="sectorLetterSpacing"
        font-weight="700"
      >{{ sectorLabel }}</text>
    </template>
    <template v-else>
      <!-- A legend describes the sector rule, not a particular failed gate. -->
      <g class="sector-flag">
        <path d="M7 21V4" />
        <path d="M7 5h10l-2.2 3L17 11H7" />
      </g>
    </template>
  </svg>
</template>
