<script setup lang="ts">
import SessionMergePanel from '../SessionMergePanel.vue'

// SessionMergePanel reads its data straight from the shared stores, so this
// card needs nothing off the context — it exists only so the dispatcher can
// treat every card uniformly.
defineProps<{ ctx?: unknown }>()
</script>

<template>
  <SessionMergePanel />
</template>
