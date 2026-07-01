<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { CornerApex } from '@/domain/analysis/cornerSpeed'
import { useAnalyzerStore } from '@/stores/analyzerStore'

const props = defineProps<{
  /** Corner apexes for the single focused lap, or null when the feature
   *  doesn't apply right now (no lap selected, multiple laps selected, or no
   *  speed channel) — see AnalyzerView's cornerApexes computed for the rule. */
  apexes: CornerApex[] | null
  /** Whether corner-speed detection is even possible (speed channel present)
   *  — distinguishes "toggle on, but nothing to show yet" from "no speed data". */
  speedAvailable: boolean
}>()

const { t } = useI18n()
const analyzer = useAnalyzerStore()

function fmtSpeed(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(1)} km/h` : '—'
}
</script>

<template>
  <div class="corner-speed-panel">
    <label class="toggle">
      <input
        type="checkbox"
        :checked="analyzer.showCornerSpeed"
        @change="analyzer.setShowCornerSpeed(($event.target as HTMLInputElement).checked)"
      />
      <span>{{ t('analyzer.cornerSpeedToggle') }}</span>
    </label>

    <template v-if="analyzer.showCornerSpeed">
      <p v-if="!props.speedAvailable" class="hint">{{ t('analyzer.cornerSpeedNoChannel') }}</p>
      <p v-else-if="props.apexes == null" class="hint">{{ t('analyzer.cornerSpeedSelectLap') }}</p>
      <p v-else-if="props.apexes.length === 0" class="hint">{{ t('analyzer.cornerSpeedNone') }}</p>
      <ul v-else class="apex-list">
        <li v-for="(a, i) in props.apexes" :key="i">
          <span class="apex-num">{{ i + 1 }}</span>
          <span class="apex-dist">{{ (a.lapDistanceM / 1000).toFixed(2) }} km</span>
          <span class="apex-speed">{{ fmtSpeed(a.speedKmh) }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.corner-speed-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: var(--space);
  padding-top: var(--space);
  border-top: 1px solid var(--color-border);
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: var(--color-text);
  cursor: pointer;
  align-self: flex-start;
}
.hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.apex-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.apex-list li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--radius);
  background: var(--color-bg);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}
.apex-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-size: 0.75rem;
  font-weight: 600;
}
.apex-dist {
  color: var(--color-text-muted);
}
.apex-speed {
  color: var(--color-text);
  font-weight: 600;
}
</style>
