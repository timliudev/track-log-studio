<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useConverterStore } from '@/stores/converterStore'

const { t } = useI18n()
const store = useConverterStore()
const { files } = storeToRefs(store)
</script>

<template>
  <section class="filelist">
    <header class="row">
      <h3>{{ t('converter.files.heading') }}</h3>
      <button v-if="files.length" type="button" class="link" @click="store.clearFiles()">
        {{ t('converter.files.clear') }}
      </button>
    </header>

    <p v-if="!files.length" class="muted">{{ t('converter.files.empty') }}</p>

    <ul v-else class="items">
      <li v-for="f in files" :key="f.id" class="item">
        <div class="info">
          <span class="name">{{ f.name }}</span>
          <span v-if="f.status === 'ready'" class="meta">
            {{ f.formatId }} · {{ t('converter.files.rows', { n: f.rowCount }) }}
          </span>
          <span v-else-if="f.status === 'parsing'" class="meta">
            {{ t('converter.files.parsing') }} {{ Math.round(f.progress * 100) }}%
          </span>
          <span v-else class="meta err">{{ t('converter.files.error') }}: {{ f.error }}</span>
        </div>
        <div v-if="f.status === 'parsing'" class="bar">
          <div class="fill" :style="{ width: `${f.progress * 100}%` }" />
        </div>
        <button type="button" class="link" @click="store.removeFile(f.id)">
          {{ t('converter.files.remove') }}
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.filelist {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
h3 {
  margin: 0;
  font-size: 1rem;
}
.muted {
  color: var(--color-text-muted);
}
.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 4px 12px;
  padding: 8px 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}
.info {
  display: flex;
  flex-direction: column;
}
.name {
  font-weight: 500;
}
.meta {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.meta.err {
  color: var(--color-accent);
}
.bar {
  grid-column: 1 / -1;
  height: 4px;
  background: var(--color-bg);
  border-radius: 2px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--color-accent);
  transition: width 0.1s linear;
}
.link {
  background: none;
  border: none;
  color: var(--color-accent);
  cursor: pointer;
  font: inherit;
}
</style>
