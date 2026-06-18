<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLapStore } from '@/stores/lapStore'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import { lapStats } from '@/domain/analysis/lapStats'
import { formatLapTime } from '@/domain/analysis/format'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'

const props = defineProps<{
  laps: Lap[]
  track: GpsTrack | null
  timeMs: Float64Array | null
  /** Whether the ECU lap channel (IR_LapNumber) is available in this session. */
  hasEcuLaps: boolean
}>()

const { t } = useI18n()
const lapStore = useLapStore()

// Cumulative distance computed once for the active track and reused per lap row.
const cumDistM = computed<Float64Array | null>(() =>
  props.track
    ? cumulativeDistanceM(props.track.lat, props.track.lon, props.track.valid)
    : null,
)

interface Row {
  index: number
  lapTime: string
  distanceKm: string
  topSpeed: string
}

const rows = computed<Row[]>(() => {
  const track = props.track
  const timeMs = props.timeMs
  const cum = cumDistM.value
  if (!track || !timeMs || !cum) {
    return props.laps.map((l) => ({
      index: l.index,
      lapTime: formatLapTime(l.lapTimeMs),
      distanceKm: '—',
      topSpeed: '—',
    }))
  }
  return props.laps.map((l) => {
    const s = lapStats(track, timeMs, cum, l)
    return {
      index: l.index,
      lapTime: formatLapTime(l.lapTimeMs),
      distanceKm: (s.distanceM / 1000).toFixed(3),
      topSpeed: s.topSpeedKmh.toFixed(1),
    }
  })
})
</script>

<template>
  <div class="lap-table">
    <div v-if="hasEcuLaps" class="source">
      <button
        type="button"
        :class="{ active: lapStore.source === 'line' }"
        @click="lapStore.setSource('line')"
      >
        {{ t('analyzer.sourceLine') }}
      </button>
      <button
        type="button"
        :class="{ active: lapStore.source === 'ecu' }"
        @click="lapStore.setSource('ecu')"
      >
        {{ t('analyzer.sourceEcu') }}
      </button>
    </div>

    <p v-if="laps.length === 0" class="empty">{{ t('analyzer.noLaps') }}</p>

    <table v-else>
      <thead>
        <tr>
          <th>{{ t('analyzer.lap') }}</th>
          <th>{{ t('analyzer.lapTime') }}</th>
          <th>{{ t('analyzer.lapDistance') }}</th>
          <th>{{ t('analyzer.topSpeed') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in rows"
          :key="r.index"
          :class="{ selected: lapStore.selectedIndex === r.index }"
          @click="lapStore.toggleLap(r.index)"
        >
          <td>{{ r.index + 1 }}</td>
          <td>{{ r.lapTime }}</td>
          <td>{{ r.distanceKm }} km</td>
          <td>{{ r.topSpeed }} km/h</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.lap-table {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 1.5);
}
.source {
  display: inline-flex;
  align-self: flex-start;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.source button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.source button.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.empty {
  color: var(--color-text-muted);
  font-size: 0.9rem;
  margin: 0;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
th,
td {
  text-align: right;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
}
th:first-child,
td:first-child {
  text-align: left;
}
th {
  color: var(--color-text-muted);
  font-weight: 600;
}
tbody tr {
  cursor: pointer;
}
tbody tr:hover {
  background: var(--color-bg);
}
tbody tr.selected {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
</style>
