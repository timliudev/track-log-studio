<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MapBackgroundKind, MapBackgroundSettings } from '@/domain/analysis/mapBackground'
import { validateBackgroundImage } from '@/domain/analysis/mapBackground'

const props = defineProps<{ settings: MapBackgroundSettings; hasImage: boolean }>()
const emit = defineEmits<{
  upload: [File]
  kind: [MapBackgroundKind]
  satelliteKey: [string]
  nudge: [number, number]
  scale: [number]
  reset: []
}>()
const { t } = useI18n()
const error = ref<string | null>(null)
function choose(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const invalid = validateBackgroundImage(file)
  if (invalid) {
    error.value = t(`analyzer.mapBackground.upload${invalid === 'type' ? 'TypeError' : 'SizeError'}`)
    return
  }
  error.value = null
  emit('upload', file)
  ;(e.target as HTMLInputElement).value = ''
}
</script>

<template>
  <details class="map-background">
    <summary>{{ t('analyzer.mapBackground.title') }}</summary>
    <div class="background-controls">
      <label>{{ t('analyzer.mapBackground.layer') }}
        <select :value="props.settings.kind" @change="emit('kind', ($event.target as HTMLSelectElement).value as MapBackgroundKind)">
          <option value="none">{{ t('analyzer.mapBackground.none') }}</option>
          <option value="image" :disabled="!hasImage">{{ t('analyzer.mapBackground.image') }}</option>
          <option value="osm">{{ t('analyzer.mapBackground.osm') }}</option>
          <option value="satellite">{{ t('analyzer.mapBackground.satellite') }}</option>
        </select>
      </label>
      <label>{{ t('analyzer.mapBackground.upload') }}
        <input type="file" accept="image/jpeg,image/png,image/webp" @change="choose" />
      </label>
      <template v-if="props.settings.kind === 'image'">
        <div class="align-buttons">
          <button type="button" :aria-label="t('analyzer.mapBackground.up')" @click="emit('nudge', 0, -12)">↑</button><button type="button" :aria-label="t('analyzer.mapBackground.left')" @click="emit('nudge', -12, 0)">←</button>
          <button type="button" :aria-label="t('analyzer.mapBackground.right')" @click="emit('nudge', 12, 0)">→</button><button type="button" :aria-label="t('analyzer.mapBackground.down')" @click="emit('nudge', 0, 12)">↓</button>
          <button type="button" :aria-label="t('analyzer.mapBackground.zoomIn')" @click="emit('scale', 1.1)">＋</button><button type="button" :aria-label="t('analyzer.mapBackground.zoomOut')" @click="emit('scale', 1 / 1.1)">－</button>
          <button type="button" @click="emit('reset')">{{ t('analyzer.mapBackground.reset') }}</button>
        </div>
      </template>
      <label v-if="props.settings.kind === 'satellite'">{{ t('analyzer.mapBackground.mapboxKey') }}
        <input type="password" autocomplete="off" :value="props.settings.satelliteApiKey" @input="emit('satelliteKey', ($event.target as HTMLInputElement).value)" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <small>{{ t('analyzer.mapBackground.localOnly') }}</small>
    </div>
  </details>
</template>

<style scoped>
.map-background { font-size: .85rem; }
.background-controls { display: grid; gap: 8px; margin-top: 6px; }
.background-controls label { display: grid; gap: 3px; }
.align-buttons { display: flex; flex-wrap: wrap; gap: 4px; }
.align-buttons button { min-width: 32px; min-height: 32px; }
:root[data-any-pointer-coarse] .align-buttons button { min-width: 44px; min-height: 44px; }
:root[data-any-pointer-coarse] summary { min-height: 44px; display: flex; align-items: center; }
.error { color: var(--color-accent); margin: 0; }
</style>
