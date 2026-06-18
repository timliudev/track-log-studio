<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useConverterStore, type PresetId } from '@/stores/converterStore'

const { t } = useI18n()
const store = useConverterStore()
const { userPresets, activePresetId } = storeToRefs(store)

const saveIndex = ref(0)
const saveName = ref('')

function onSelect(e: Event): void {
  store.applyPreset((e.target as HTMLSelectElement).value as PresetId)
}

function onSave(): void {
  const name = saveName.value.trim() || `User ${saveIndex.value + 1}`
  store.saveToUser(saveIndex.value, name)
  saveName.value = ''
}
</script>

<template>
  <section class="presetbar">
    <h3>{{ t('converter.preset.heading') }}</h3>

    <div class="controls">
      <label class="field">
        <span>{{ t('converter.preset.current') }}</span>
        <select :value="activePresetId" @change="onSelect">
          <option value="default">{{ t('converter.preset.default') }}</option>
          <option v-if="activePresetId === 'custom'" value="custom">
            {{ t('converter.preset.custom') }}
          </option>
          <option
            v-for="(p, i) in userPresets"
            :key="i"
            :value="`user${i + 1}`"
          >
            {{ p ? p.name : t('converter.preset.userEmpty', { n: i + 1 }) }}
          </option>
        </select>
      </label>

      <button type="button" class="btn-secondary" @click="store.reset()">
        {{ t('converter.preset.reset') }}
      </button>
    </div>

    <div class="save-row">
      <span>{{ t('converter.preset.saveTo') }}</span>
      <select v-model.number="saveIndex">
        <option v-for="i in 5" :key="i" :value="i - 1">{{ i }}</option>
      </select>
      <input
        v-model="saveName"
        type="text"
        :placeholder="t('converter.preset.name')"
        class="name-input"
      />
      <button type="button" class="btn-secondary" @click="onSave">
        {{ t('converter.preset.save') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.presetbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
h3 {
  margin: 0;
  font-size: 1rem;
}
.controls,
.save-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
select,
.name-input {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.btn-secondary {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.btn-secondary:hover {
  border-color: var(--color-accent);
}
</style>
