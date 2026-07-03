<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useConverterStore } from '@/stores/converterStore'

const { t } = useI18n()
const { vboChannelMap } = storeToRefs(useConverterStore())

const hasRows = computed(() => vboChannelMap.value.length > 0)
// Channel rows only (exclude the 7 fixed GPS rows) for the count.
const channelCount = computed(
  () => vboChannelMap.value.filter((r) => r.kind !== 'gps').length,
)
</script>

<template>
  <section class="vbo-map">
    <header class="head">
      <h3>{{ t('converter.vboMap.heading') }}</h3>
      <span v-if="hasRows" class="count">{{ t('converter.vboMap.count', { n: channelCount }) }}</span>
    </header>
    <p class="hint muted">{{ t('converter.vboMap.hint') }}</p>

    <p v-if="!hasRows" class="muted">{{ t('converter.vboMap.needFile') }}</p>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('converter.vboMap.col.ecu') }}</th>
            <th>{{ t('converter.vboMap.col.desc') }}</th>
            <th>{{ t('converter.vboMap.col.rcId') }}</th>
            <th>{{ t('converter.vboMap.col.unit') }}</th>
            <th>{{ t('converter.vboMap.col.kind') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in vboChannelMap" :key="i" :class="{ gps: row.kind === 'gps' }">
            <td class="mono">{{ row.ecu }}</td>
            <td>{{ row.description }}</td>
            <td class="mono rc">{{ row.rcId }}</td>
            <td>{{ row.unit }}</td>
            <td>
              <span class="badge" :class="row.kind">{{ t(`converter.vboMap.kind.${row.kind}`) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.vbo-map {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
h3 {
  margin: 0;
  font-size: 1rem;
}
.count {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.hint {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
}
.muted {
  color: var(--color-text-muted);
}
.table-wrap {
  max-height: 60vh;
  overflow: auto;
  /* Without this, a flex/grid ancestor sizes this box to the table's
     min-content width (long unbroken ecu/rcId strings) instead of the
     available space, defeating the overflow-x scroll below and pushing the
     whole Converter layout wider than the viewport on mobile. */
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
thead th {
  position: sticky;
  top: 0;
  background: var(--color-surface);
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-weight: 600;
  white-space: nowrap;
}
tbody td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}
tbody tr:last-child td {
  border-bottom: none;
}
tr.gps td {
  background: color-mix(in srgb, var(--color-accent) 7%, transparent);
}
.mono {
  font-family: ui-monospace, monospace;
}
.rc {
  color: var(--color-accent);
}
.badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 0.72rem;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  white-space: nowrap;
}
.badge.semantic {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
