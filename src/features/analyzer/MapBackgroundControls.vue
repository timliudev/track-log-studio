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

// B60 — 原本用 <details>/<summary>，收折箭頭吃瀏覽器 UA 預設的 disclosure
// marker；桌面 Chrome 會畫出來，但 Android Chrome 對這顆 marker 的呈現不一致
// （常見狀況是完全不畫），使用者因此看不到收折控制、以為區塊卡住展開/收合
// 不了。改成一顆常駐可見的按鈕，箭頭是內嵌 SVG（不吃任何 UA 預設樣式），
// 展開/收合完全由這裡的 `collapsed` state 驅動，不再依賴 <details> 原生行為。
const collapsed = ref(true)

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
  <div class="map-background" :class="{ collapsed }">
    <button
      type="button"
      class="toggle"
      :aria-expanded="!collapsed"
      :aria-label="`${t('analyzer.mapBackground.title')} — ${t(collapsed ? 'analyzer.layout.expand' : 'analyzer.layout.collapse')}`"
      @click="collapsed = !collapsed"
    >
      <span class="toggle-label">{{ t('analyzer.mapBackground.title') }}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="chevron">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
    <div v-if="!collapsed" class="background-controls">
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
    </div>
  </div>
</template>

<style scoped>
.map-background { font-size: .85rem; }
.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 2px 0;
  background: none;
  border: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  /* B60 — 常駐可點擊區域，不靠 hover 呈現（DESIGN.md §8 觸控政策）。 */
  min-height: 24px;
}
:root[data-any-pointer-coarse] .toggle { min-height: 44px; }
.toggle-label { flex: 1; text-align: left; }
.chevron {
  width: 16px;
  height: 16px;
  flex: none;
  transition: transform 0.15s ease;
}
:root[data-any-pointer-coarse] .chevron { width: 20px; height: 20px; }
/* 收合時箭頭轉向右（▶ 提示可展開），展開時維持向下（▼ 提示可收合）。 */
.map-background.collapsed .chevron { transform: rotate(-90deg); }
.background-controls { display: grid; gap: 8px; margin-top: 6px; }
.background-controls label { display: grid; gap: 3px; }
.background-controls select,
.background-controls input { min-height: 28px; font: inherit; }
.align-buttons { display: flex; flex-wrap: wrap; gap: 4px; }
.align-buttons button { min-width: 32px; min-height: 32px; }
:root[data-any-pointer-coarse] .background-controls select,
:root[data-any-pointer-coarse] .background-controls input { min-height: 44px; }
:root[data-any-pointer-coarse] .align-buttons button { min-width: 44px; min-height: 44px; }
.error { color: var(--color-accent); margin: 0; }
</style>
