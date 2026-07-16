<script setup lang="ts">
export type LapExclusionReason = 'manual' | 'timeBand' | 'distBand' | 'sector'

defineProps<{ reason: LapExclusionReason }>()
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
    <template v-else>
      <path d="M5 21V4m0 1h10l-2 4 2 4H5" />
    </template>
  </svg>
</template>
