<script setup lang="ts">
// Thin converter-page wrapper around the shared calibration form (see
// `SuspensionCalibrationForm.vue`'s doc) — feeds it every ready session so
// the reverse-calc / channel picker can see every loaded file, regardless of
// its imported format.
import { useConverterStore } from '@/stores/converterStore'
import SuspensionCalibrationForm from '@/components/SuspensionCalibrationForm.vue'

const conv = useConverterStore()
</script>

<template>
  <SuspensionCalibrationForm :sessions="conv.readySessions" />
</template>
