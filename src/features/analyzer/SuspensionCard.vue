<script setup lang="ts">
/**
 * Analyzer-side suspension calibration entry point. Item #3 of the
 * suspension/.loga decoupling work: the converter page already had
 * `SuspensionPanel.vue` as the only place to edit calibration — this card
 * gives the analyzer page an equivalent edit entry, reading/writing the SAME
 * `useSuspensionStore` (see `SuspensionCalibrationForm.vue`'s doc), so a
 * change made here is visible on the converter page too, and vice versa —
 * they're the same reactive Pinia store, not two copies.
 *
 * Default view is a compact status line per part (enabled/disabled, source
 * channel, calibrated range); the full form is behind an explicit "edit"
 * toggle so this card doesn't dominate the dashboard when the user isn't
 * actively tuning calibration. Editing here reflects in any chart on this
 * page immediately — `useActiveSession` recomputes the derived `Front/Rear
 * Suspension` channels from the same store on every change, no extra wiring
 * needed.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSession } from '@/domain/model/LogSession'
import { useSuspensionStore } from '@/stores/suspensionStore'
import { PARTS, type SuspensionPart } from '@/domain/units/suspension'
import SuspensionCalibrationForm from '@/components/SuspensionCalibrationForm.vue'

const props = defineProps<{
  /** The active session (any imported format), or null when nothing is
   *  loaded — used only to flag whether the configured source channel is
   *  actually present in the current record. */
  session: LogSession | null
}>()

const { t } = useI18n()
const susp = useSuspensionStore()
const editing = ref(false)

function channelPresent(part: SuspensionPart): boolean {
  const name = susp.config[part].sourceChannel
  return !!name && (props.session?.has(name) ?? false)
}
</script>

<template>
  <div class="suspension-card">
    <p v-if="!editing" class="status-list">
      <span v-for="part in PARTS" :key="part" class="status-line">
        <strong>{{ t(`suspension.${part}`) }}</strong>
        <template v-if="susp.config[part].enabled">
          {{ ' ' }}{{ t('suspension.statusEnabled', { channel: susp.config[part].sourceChannel, min: susp.config[part].minMm, max: susp.config[part].maxMm }) }}
          <span v-if="session && !channelPresent(part)" class="warn">{{ t('suspension.statusChannelMissing') }}</span>
        </template>
        <template v-else>{{ ' ' }}{{ t('suspension.statusDisabled') }}</template>
      </span>
    </p>

    <button type="button" class="btn-secondary edit-toggle" @click="editing = !editing">
      {{ editing ? t('suspension.analyzerEditClose') : t('suspension.analyzerEdit') }}
    </button>

    <p v-if="!session" class="hint">{{ t('suspension.analyzerNoSession') }}</p>

    <SuspensionCalibrationForm v-if="editing" :sessions="session ? [session] : []" />
  </div>
</template>

<style scoped>
.suspension-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.status-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9rem;
  color: var(--color-text);
}
.status-line strong {
  margin-right: 4px;
}
.warn {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}
.edit-toggle {
  align-self: flex-start;
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
  color: var(--color-accent);
}
.hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
</style>
