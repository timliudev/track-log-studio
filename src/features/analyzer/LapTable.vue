<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLapStore } from '@/stores/lapStore'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import { lapStats } from '@/domain/analysis/lapStats'
import { formatLapTime } from '@/domain/analysis/format'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'
import type { LogSession } from '@/domain/model/LogSession'

const props = defineProps<{
  laps: Lap[]
  track: GpsTrack | null
  timeMs: Float64Array | null
  /** Active session, used to resolve the real speed channel for top speed. */
  session: LogSession | null
  /** Whether the ECU lap channel (IR_LapNumber) is available in this session. */
  hasEcuLaps: boolean
}>()

const { t } = useI18n()
const lapStore = useLapStore()

// Selection changes are routed to the parent (which owns the zoom coupling) so
// it can decide whether to also reset the zoom; we never mutate the selection
// store directly here.
const emit = defineEmits<{ select: [number | null] }>()

// Cumulative distance computed once for the active track and reused per lap row.
const cumDistM = computed<Float64Array | null>(() =>
  props.track
    ? cumulativeDistanceM(props.track.lat, props.track.lon, props.track.valid)
    : null,
)

// Real speed channel for top speed: GPS_Speed (already km/h in both .loga and
// NMEA-sourced sessions) preferred over Vehicle_Speed. null when neither exists,
// in which case top speed is unknown and rendered as '—'.
const speedKmh = computed<Float32Array | null>(
  () => props.session?.get('GPS_Speed')?.data ?? props.session?.get('Vehicle_Speed')?.data ?? null,
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
  const speed = speedKmh.value
  return props.laps.map((l) => {
    const s = lapStats(track, timeMs, cum, speed, l)
    return {
      index: l.index,
      lapTime: formatLapTime(l.lapTimeMs),
      distanceKm: (s.distanceM / 1000).toFixed(3),
      topSpeed: Number.isNaN(s.topSpeedKmh) ? '—' : s.topSpeedKmh.toFixed(1),
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

    <button
      v-if="lapStore.selectedIndex != null"
      type="button"
      class="clear-selection"
      @click="emit('select', null)"
    >
      {{ t('analyzer.clearLapSelection') }}
    </button>

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
          @click="emit('select', lapStore.selectedIndex === r.index ? null : r.index)"
        >
          <td>{{ r.index + 1 }}</td>
          <td>{{ r.lapTime }}</td>
          <td>{{ r.distanceKm }} km</td>
          <td>{{ r.topSpeed === '—' ? '—' : `${r.topSpeed} km/h` }}</td>
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
.clear-selection {
  align-self: flex-start;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.clear-selection:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
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
