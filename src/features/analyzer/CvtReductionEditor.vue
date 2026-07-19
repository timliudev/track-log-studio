<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { FixedReductionInput } from '@/domain/analysis/cvtDynamics'

const props = defineProps<{
  modelValue: FixedReductionInput
  label: string
}>()
const emit = defineEmits<{ 'update:modelValue': [FixedReductionInput] }>()
const { t } = useI18n()

function numberValue(event: Event): number {
  const value = Number((event.target as HTMLInputElement).value)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function setMode(event: Event): void {
  const mode = (event.target as HTMLSelectElement).value === 'stages' ? 'stages' : 'ratio'
  emit('update:modelValue', { ...props.modelValue, mode })
}

function setRatio(event: Event): void {
  emit('update:modelValue', { ...props.modelValue, ratio: numberValue(event) })
}

function setStage(index: number, key: 'driveTeeth' | 'drivenTeeth', event: Event): void {
  const stages = props.modelValue.stages.map((stage, current) =>
    current === index ? { ...stage, [key]: numberValue(event) } : stage,
  )
  emit('update:modelValue', { ...props.modelValue, stages })
}

function addStage(): void {
  emit('update:modelValue', {
    ...props.modelValue,
    stages: [...props.modelValue.stages, { driveTeeth: 0, drivenTeeth: 0 }],
  })
}

function removeStage(index: number): void {
  emit('update:modelValue', {
    ...props.modelValue,
    stages: props.modelValue.stages.filter((_, current) => current !== index),
  })
}
</script>

<template>
  <fieldset class="reduction-editor">
    <legend>{{ label }}</legend>
    <label>
      <span>{{ t('analyzer.cvt.inputMethod') }}</span>
      <select :value="modelValue.mode" @change="setMode">
        <option value="ratio">{{ t('analyzer.cvt.directRatio') }}</option>
        <option value="stages">{{ t('analyzer.cvt.multipleShafts') }}</option>
      </select>
    </label>
    <label v-if="modelValue.mode === 'ratio'">
      <span>{{ t('analyzer.cvt.reductionRatio') }}</span>
      <input type="number" inputmode="decimal" min="0" step="0.001" :value="modelValue.ratio || ''" @change="setRatio" />
    </label>
    <div v-else class="stage-list">
      <div v-for="(stage, index) in modelValue.stages" :key="index" class="stage-row">
        <span>{{ t('analyzer.cvt.shaftStage', { n: index + 1 }) }}</span>
        <label>
          <span>{{ t('analyzer.gear.driveTeeth') }}</span>
          <input type="number" inputmode="numeric" min="1" step="1" :value="stage.driveTeeth || ''" @change="setStage(index, 'driveTeeth', $event)" />
        </label>
        <label>
          <span>{{ t('analyzer.gear.drivenTeeth') }}</span>
          <input type="number" inputmode="numeric" min="1" step="1" :value="stage.drivenTeeth || ''" @change="setStage(index, 'drivenTeeth', $event)" />
        </label>
        <button type="button" class="icon-button" :aria-label="t('analyzer.cvt.removeStage')" @click="removeStage(index)">×</button>
      </div>
      <button type="button" class="secondary-button" @click="addStage">{{ t('analyzer.cvt.addStage') }}</button>
    </div>
  </fieldset>
</template>

<style scoped>
.reduction-editor {
  min-width: 0;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}
legend { padding: 0 5px; font-weight: 600; }
label { display: grid; gap: 5px; min-width: 0; font-size: 0.78rem; color: var(--color-text-muted); }
select, input {
  min-width: 0;
  min-height: 36px;
  padding: 6px 8px;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 0.75);
}
.stage-list { display: grid; gap: 8px; }
.stage-row { display: grid; grid-template-columns: auto 1fr 1fr auto; gap: 8px; align-items: end; }
.icon-button, .secondary-button {
  min-height: 36px;
  padding: 6px 10px;
  color: var(--color-text);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  cursor: pointer;
}
:root[data-any-pointer-coarse='true'] .icon-button,
:root[data-any-pointer-coarse='true'] .secondary-button,
:root[data-any-pointer-coarse='true'] select,
:root[data-any-pointer-coarse='true'] input { min-height: 44px; }
@media (max-width: 520px) {
  .stage-row { grid-template-columns: 1fr 1fr auto; }
  .stage-row > span { grid-column: 1 / -1; }
}
</style>
