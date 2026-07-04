<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useConverterStore } from '@/stores/converterStore'
import type { SlotId } from '@/domain/export/rc3Nmea/mapping'
import SearchableSelect from '@/components/SearchableSelect.vue'

const { t } = useI18n()
const store = useConverterStore()
const { mapping, availableChannels } = storeToRefs(store)

const hasFiles = computed(() => availableChannels.value.length > 0)
const accelPresent = computed(() =>
  availableChannels.value.some((c) => c.name === 'TC_Xforce'),
)
const gyroPresent = computed(() =>
  availableChannels.value.some((c) => c.name === 'TC_Xangle_dps'),
)

function onSlotChange(slot: SlotId, channel: string | null): void {
  store.setSlot(slot, channel)
}
</script>

<template>
  <section class="mapping">
    <h3>{{ t('converter.mapping.heading') }}</h3>

    <div class="fixed">
      <h4>{{ t('converter.mapping.fixedHeading') }}</h4>
      <ul>
        <li>{{ accelPresent ? t('converter.mapping.accel') : t('converter.mapping.accelAbsent') }}</li>
        <li>{{ gyroPresent ? t('converter.mapping.gyro') : t('converter.mapping.gyroAbsent') }}</li>
        <li>{{ t('converter.mapping.rpm') }}</li>
      </ul>
    </div>

    <p v-if="!hasFiles" class="muted">{{ t('converter.mapping.needFile') }}</p>

    <div class="slots">
      <div v-for="slot in store.slotIds" :key="slot" class="slot-row">
        <span class="slot-id">{{ slot }}</span>
        <SearchableSelect
          :model-value="mapping[slot].channel"
          :options="availableChannels"
          :disabled="!hasFiles"
          @update:model-value="(v) => onSlotChange(slot, v)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.mapping {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
h3 {
  margin: 0;
  font-size: 1rem;
}
h4 {
  margin: 0 0 4px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.fixed ul {
  margin: 0;
  padding-left: 18px;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  line-height: 1.6;
}
.muted {
  color: var(--color-text-muted);
}
.slots {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.slot-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
.slot-id {
  font-family: ui-monospace, monospace;
  color: var(--color-accent);
  font-size: 0.9rem;
}
</style>
