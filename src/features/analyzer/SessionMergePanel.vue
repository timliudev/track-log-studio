<script setup lang="ts">
/**
 * Phase 5 UI — GPS session merge (見 docs/PHASE5-MERGE-STATUS.md「建議後續步驟」).
 * 讓使用者挑選一份缺 GPS 的主要記錄 + 一份有乾淨 GPS 的記錄,自動抓出兩者時鐘偏移
 * (crossCorrelateOffset),可微調後合併(mergeSessions),合併結果掛回 fileStore
 * 成為一份新的、可分析/可匯出的記錄。所有邏輯都在 useSessionMerge composable,
 * 這裡只負責畫面與使用者互動的串接。
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionMerge, NUDGE_STEP_MS } from '@/composables/useSessionMerge'

const { t } = useI18n()
const merge = useSessionMerge()

const mergedName = ref<string | null>(null)

// Any change to the picked sessions invalidates a previous alignment/merge
// result — re-picking is a deliberate "start over" action.
watch([merge.baseId, merge.gpsId], () => {
  merge.alignment.value = null
  mergedName.value = null
})

function onMerge(): void {
  const id = merge.merge()
  if (id == null) return
  const file = merge.candidates.value.find((c) => c.id === id)
  mergedName.value = file?.name ?? null
}

function fmtOffset(ms: number): string {
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : ''
  return `${sign}${Math.abs(ms).toFixed(0)}`
}
</script>

<template>
  <div class="session-merge">
    <p class="hint">{{ t('analyzer.sessionMerge.hint') }}</p>

    <p v-if="merge.candidates.value.length < 2" class="need-two">
      {{ t('analyzer.sessionMerge.needTwo') }}
    </p>

    <template v-else>
      <div class="row">
        <label class="picker">
          <span>{{ t('analyzer.sessionMerge.base') }}</span>
          <select v-model.number="merge.baseId.value">
            <option :value="null">{{ t('analyzer.sessionMerge.pick') }}</option>
            <option v-for="c in merge.candidates.value" :key="c.id" :value="c.id">
              {{ c.name }}{{ c.hasSpeedChannel ? '' : t('analyzer.sessionMerge.noSpeed') }}
            </option>
          </select>
        </label>
        <label class="picker">
          <span>{{ t('analyzer.sessionMerge.gps') }}</span>
          <select v-model.number="merge.gpsId.value">
            <option :value="null">{{ t('analyzer.sessionMerge.pick') }}</option>
            <option v-for="c in merge.candidates.value" :key="c.id" :value="c.id">
              {{ c.name }}{{ c.hasSpeedChannel ? '' : t('analyzer.sessionMerge.noSpeed') }}
            </option>
          </select>
        </label>
      </div>

      <div class="row actions">
        <button type="button" class="align" :disabled="!merge.canAlign.value" @click="merge.autoAlign()">
          {{ t('analyzer.sessionMerge.autoAlign') }}
        </button>
      </div>

      <p v-if="merge.lastError.value" class="error">
        {{ t(`analyzer.sessionMerge.errors.${merge.lastError.value}`) }}
      </p>

      <div v-if="merge.offsetMs.value != null" class="offset-panel">
        <div class="offset-row">
          <span class="label">{{ t('analyzer.sessionMerge.offset') }}</span>
          <button type="button" class="nudge" @click="merge.nudge(-NUDGE_STEP_MS)">
            {{ t('analyzer.sessionMerge.nudgeMinus') }}
          </button>
          <span class="value">{{ fmtOffset(merge.offsetMs.value) }} {{ t('analyzer.sessionMerge.offsetUnit') }}</span>
          <button type="button" class="nudge" @click="merge.nudge(NUDGE_STEP_MS)">
            {{ t('analyzer.sessionMerge.nudgePlus') }}
          </button>
        </div>
        <p v-if="merge.alignment.value" class="score">
          {{ t('analyzer.sessionMerge.score') }}: {{ merge.alignment.value.score.toFixed(3) }}
        </p>
      </div>

      <div class="row actions">
        <button type="button" class="merge" :disabled="!merge.canMerge.value" @click="onMerge">
          {{ t('analyzer.sessionMerge.merge') }}
        </button>
      </div>

      <p v-if="mergedName" class="merged-ok">
        {{ t('analyzer.sessionMerge.merged', { name: mergedName }) }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.session-merge {
  display: flex;
  flex-direction: column;
  gap: var(--space);
}
.hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.need-two {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
  flex: 1 1 180px;
}
.picker select {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 8px;
  font: inherit;
}
.actions {
  align-items: center;
}
.align,
.merge {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 14px;
  font: inherit;
  cursor: pointer;
}
.align:hover:not(:disabled),
.merge:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.align:disabled,
.merge:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.merge {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.error {
  margin: 0;
  font-size: 0.8rem;
  color: #ff6b6b;
}
.offset-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}
.offset-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.offset-row .label {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.nudge {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 4px 8px;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.nudge:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.offset-row .value {
  min-width: 6em;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.score {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.merged-ok {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-accent);
}
</style>
