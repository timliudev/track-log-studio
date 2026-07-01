<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSession } from '@/domain/model/LogSession'
import type { Lap } from '@/domain/model/Lap'
import { buildGgPoints } from '@/domain/analysis/ggData'
import { lapColor } from './lapColors'
import SearchableSelect from '@/components/SearchableSelect.vue'
import GgChart, { type GgSeries } from './GgChart.vue'

// aRacer IMU force channels are stored in milli-g; axis identification isn't
// solved for raw TC_* forces (see project memory), so the user picks which
// channel maps to X/Y rather than us guessing lateral vs longitudinal.
const MILLI_G_SCALE = 0.001
const MAX_POINTS = 5000

const props = defineProps<{
  session: LogSession | null
  /** Selected laps in selection order (for per-lap coloring), or empty for
   *  whole-session single-color plotting. */
  selectedLaps: Lap[]
}>()

const { t } = useI18n()

// Any channel that looks like a force channel — broad match so this isn't
// hard-locked to the exact aRacer TC_Xforce/TC_Yforce names.
const forceChannelOptions = computed(() => {
  const s = props.session
  if (!s) return []
  return s.channels
    .filter((c) => /force/i.test(c.name))
    .map((c) => ({ name: c.name, description: c.description }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const hasForceChannels = computed(() => forceChannelOptions.value.length > 0)

// Self-contained selection state (this is a standalone prototype panel, not
// wired into analyzerStore/persistence yet) — default to TC_Xforce/TC_Yforce
// when present, else leave unset so the user picks.
const xChannel = ref<string | null>(null)
const yChannel = ref<string | null>(null)

watch(
  () => props.session,
  (s) => {
    if (!s) {
      xChannel.value = null
      yChannel.value = null
      return
    }
    xChannel.value = s.has('TC_Xforce') ? 'TC_Xforce' : null
    yChannel.value = s.has('TC_Yforce') ? 'TC_Yforce' : null
  },
  { immediate: true },
)

const ggSeries = computed<GgSeries[]>(() => {
  const s = props.session
  const xName = xChannel.value
  const yName = yChannel.value
  if (!s || !xName || !yName) return []
  const xCh = s.get(xName)
  const yCh = s.get(yName)
  if (!xCh || !yCh) return []

  if (props.selectedLaps.length === 0) {
    const points = buildGgPoints(xCh.data, yCh.data, {
      scale: MILLI_G_SCALE,
      maxPoints: MAX_POINTS,
    })
    return [{ points, color: '#4363d8', name: t('analyzer.gg.session') }]
  }

  return props.selectedLaps.map((lap, order) => ({
    points: buildGgPoints(xCh.data, yCh.data, {
      scale: MILLI_G_SCALE,
      start: lap.startIdx,
      end: lap.endIdx,
      maxPoints: MAX_POINTS,
    }),
    color: lapColor(order),
    name: t('analyzer.gg.lapSeries', { n: lap.index + 1 }),
  }))
})
</script>

<template>
  <div class="gg-panel">
    <h3 class="gg-title">{{ t('analyzer.gg.title') }}</h3>

    <p v-if="!hasForceChannels" class="hint">{{ t('analyzer.gg.noChannels') }}</p>
    <template v-else>
      <div class="gg-controls">
        <label class="field">
          <span>{{ t('analyzer.gg.xAxis') }}</span>
          <SearchableSelect v-model="xChannel" :options="forceChannelOptions" />
        </label>
        <label class="field">
          <span>{{ t('analyzer.gg.yAxis') }}</span>
          <SearchableSelect v-model="yChannel" :options="forceChannelOptions" />
        </label>
      </div>

      <p v-if="!xChannel || !yChannel" class="hint">{{ t('analyzer.gg.pickBoth') }}</p>
      <GgChart v-else :series="ggSeries" />
    </template>
  </div>
</template>

<style scoped>
.gg-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gg-title {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text);
}
.gg-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.field {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  flex: 1 1 220px;
  min-width: 180px;
}
.hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
</style>
