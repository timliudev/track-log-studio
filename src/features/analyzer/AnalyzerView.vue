<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useFileStore } from '@/stores/fileStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useActiveSession } from '@/composables/useActiveSession'
import { useLaps } from '@/composables/useLaps'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { lapColor } from './lapColors'
import { normalizeChannel } from '@/domain/analysis/trackHeatmap'
import { COLORMAP_IDS, colormapSwatches, type ColormapId } from '@/domain/analysis/colormap'
import TrackMap from './TrackMap.vue'
import TimeSeriesChart from './TimeSeriesChart.vue'
import LapTable from './LapTable.vue'
import LapAlignPanel from './LapAlignPanel.vue'
import MapAlignPanel from './MapAlignPanel.vue'
import SectorPanel from './SectorPanel.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'

const { t } = useI18n()
const fileStore = useFileStore()
const analyzer = useAnalyzerStore()
const lapStore = useLapStore()
const sectorStore = useSectorStore()
const { charts, xAxis, xRange, cursorIdx, trackColorChannel, trackColormap } = storeToRefs(analyzer)
const { session, track, xValues } = useActiveSession()
const { laps, timeMs, resetLine } = useLaps()

const readyFiles = computed(() => fileStore.files.filter((f) => f.status === 'ready'))

const hasEcuLaps = computed(() => session.value?.has('IR_LapNumber') ?? false)

// The selected laps (from the table) resolved to Lap objects, in selection
// order (so each gets a stable color); missing indices are filtered out.
const selectedLaps = computed(() =>
  lapStore.selected
    .map((i) => laps.value.find((l) => l.index === i))
    .filter((l): l is NonNullable<typeof l> => l != null),
)

// The alignment panel only makes sense when laps are being overlaid: at least
// one chart in overlay mode and ≥2 laps selected to compare/align.
const showAlign = computed(
  () => selectedLaps.value.length >= 2 && charts.value.some((c) => c.mode === 'overlay'),
)

// One colored segment per selected lap; color is assigned by selection order.
// `offset` is the per-lap MAP position nudge (metres east/north) so GNSS-drifted
// racing lines can be aligned on the track map (#9 spatial half).
const highlightLaps = computed(() =>
  selectedLaps.value.map((lap, order) => ({
    startIdx: lap.startIdx,
    endIdx: lap.endIdx,
    color: lapColor(order),
    offset: lapStore.mapOffsetOf(lap.index),
  })),
)

// The map-alignment panel applies to whatever laps are drawn on the map, so it
// shows whenever ≥2 laps are selected (independent of any overlay chart).
const showMapAlign = computed(() => selectedLaps.value.length >= 2)

// Sector gates for the track map: confirmed gates (solid) plus any pending
// auto-detected suggestions awaiting accept/reject (dashed) — see SectorPanel.
const mapGates = computed(() => [
  ...sectorStore.gates.map((line) => ({ line, confirmed: true })),
  ...sectorStore.suggestions.map((s) => ({ line: s.line, confirmed: false })),
])

// --- Track heatmap (#10/#11): colour the track by a channel's value. ---
// Channels offered for colouring (all of them, sorted), for the picker.
const channelOptions = computed(() =>
  (session.value?.channels ?? [])
    .map((c) => ({ name: c.name, description: c.description }))
    .sort((a, b) => a.name.localeCompare(b.name)),
)

// Normalise the chosen channel over the track (null when none chosen / absent).
const heatNorm = computed(() => {
  const name = trackColorChannel.value
  const tk = track.value
  if (!name || !tk) return null
  const ch = session.value?.get(name)
  if (!ch) return null
  return normalizeChannel(ch.data, tk.valid)
})
const colorValues = computed(() => heatNorm.value?.norm ?? null)

// Legend: a CSS gradient of the active colormap + the channel's min/max.
const legendGradient = computed(
  () => `linear-gradient(to right, ${colormapSwatches(trackColormap.value, 16).join(',')})`,
)
function colormapPreview(id: ColormapId): string {
  return `linear-gradient(to right, ${colormapSwatches(id, 8).join(',')})`
}
// Compact value label for the legend ends — fewer decimals as magnitude grows.
function fmtVal(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  return v.toFixed(a < 10 ? 2 : a < 100 ? 1 : 0)
}

// Lap selection from the table is routed here so this component (which owns the
// select↔zoom coupling) stays the single place that decides zoom side-effects.
// The zoom rule is applied imperatively right after toggling — no state-writing
// watcher — to keep selection and zoom from fighting each other.
function onLapSelect(index: number | null): void {
  // Explicit clear (clear button) → empty selection + full view.
  if (index == null) {
    lapStore.clearSelection()
    analyzer.setXRange(null)
    return
  }
  lapStore.toggleLap(index)
  const sel = lapStore.selected
  const xs = xValues.value
  if (sel.length === 1 && xs) {
    // Exactly one lap selected → zoom the charts to its span.
    const lap = laps.value.find((l) => l.index === sel[0])
    if (lap) analyzer.setXRange({ min: xs[lap.startIdx], max: xs[lap.endIdx] })
  } else {
    // 0 selected (toggled the last one off) or ≥2 (comparison) → full view so
    // every selected lap is visible at once.
    analyzer.setXRange(null)
  }
}

// Switching the X unit (time↔distance) invalidates any shared zoom range; the
// selected laps' spans are in the old units, so clear the selection too.
watch(xAxis, () => {
  lapStore.clearSelection()
  analyzer.setXRange(null)
})

watch(
  readyFiles,
  (files) => {
    const exists = files.some((f) => f.id === analyzer.activeFileId)
    if (!exists) analyzer.activeFileId = files.length ? files[0].id : null
  },
  { immediate: true },
)

// Fired ONLY on user drag-zoom or double-click-reset (the programmatic
// select→zoom path sets a guard in UPlotChart so it never echoes here).
function onXZoom(r: { min: number; max: number } | null): void {
  analyzer.setXRange(r)
  // A single-lap selection is zoom-coupled (selecting it drove this zoom), so a
  // manual zoom means the user moved off it → deselect. A multi-lap selection is
  // a track comparison that's independent of chart zoom, so leave it intact.
  if (lapStore.selected.length <= 1) lapStore.clearSelection()
}

function onSelect(e: Event): void {
  analyzer.activeFileId = Number((e.target as HTMLSelectElement).value)
}

// --- Valid lap-time band (時間帶過濾): laps whose time is outside [min, max]
// seconds are auto-excluded via the lapStore. Each input is independent; an
// empty field leaves that side open, and clearing both removes the band. ---
const bandMin = computed<number | null>({
  get: () => lapStore.lapTimeBand?.minSec ?? null,
  set: (v) => lapStore.setLapTimeBand({ minSec: v, maxSec: lapStore.lapTimeBand?.maxSec ?? null }),
})
const bandMax = computed<number | null>({
  get: () => lapStore.lapTimeBand?.maxSec ?? null,
  set: (v) => lapStore.setLapTimeBand({ minSec: lapStore.lapTimeBand?.minSec ?? null, maxSec: v }),
})

/** Parse a band <input>'s value to seconds, or null when blank/non-numeric. */
function onBandInput(which: 'min' | 'max', e: Event): void {
  const raw = (e.target as HTMLInputElement).value.trim()
  const v = raw === '' ? null : Number(raw)
  const sec = v != null && Number.isFinite(v) ? v : null
  if (which === 'min') bandMin.value = sec
  else bandMax.value = sec
}

// How many laps the band currently excludes (0 when no band) — a quick sanity
// readout so the user can see the filter is doing something.
const bandExcludedCount = computed(() => lapStore.bandExcluded.length)

// How many laps fail the sector-gate-crossing check (0 when no gates are
// confirmed yet) — mirrors bandExcludedCount, shown next to the sector panel.
const sectorInvalidCount = computed(() => lapStore.sectorInvalid.length)
</script>

<template>
  <div class="analyzer">
    <p v-if="readyFiles.length === 0" class="empty">{{ t('analyzer.noFiles') }}</p>

    <template v-else>
      <div class="toolbar">
        <label class="record">
          <span>{{ t('analyzer.record') }}</span>
          <select name="record" :value="analyzer.activeFileId ?? ''" @change="onSelect">
            <option v-for="f in readyFiles" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
        </label>
        <div class="xaxis">
          <button type="button" :class="{ active: xAxis === 'time' }" @click="analyzer.xAxis = 'time'">
            {{ t('analyzer.time') }}
          </button>
          <button type="button" :class="{ active: xAxis === 'distance' }" @click="analyzer.xAxis = 'distance'">
            {{ t('analyzer.distance') }}
          </button>
        </div>
      </div>

      <div class="card">
        <TrackMap
          :track="track"
          :cursor-idx="cursorIdx"
          :line="lapStore.line"
          :highlight-laps="highlightLaps"
          :color-values="colorValues"
          :colormap="trackColormap"
          :gates="mapGates"
          @cursor="analyzer.setCursor"
          @update:line="lapStore.setLine($event)"
        />
        <div class="track-color">
          <label class="tc-channel">
            <span>{{ t('analyzer.trackColor') }}</span>
            <SearchableSelect
              :model-value="trackColorChannel"
              :options="channelOptions"
              @update:model-value="analyzer.setTrackColorChannel($event)"
            />
          </label>
          <div v-if="heatNorm" class="tc-maps" role="group" :aria-label="t('analyzer.colormap')">
            <button
              v-for="id in COLORMAP_IDS"
              :key="id"
              type="button"
              class="tc-swatch"
              :class="{ active: trackColormap === id }"
              :style="{ background: colormapPreview(id) }"
              :title="id"
              @click="analyzer.setTrackColormap(id)"
            />
          </div>
        </div>
        <div v-if="heatNorm" class="tc-legend">
          <span class="tc-end">{{ fmtVal(heatNorm.min) }}</span>
          <span class="tc-bar" :style="{ background: legendGradient }" />
          <span class="tc-end">{{ fmtVal(heatNorm.max) }}</span>
          <span class="tc-name">{{ trackColorChannel }}</span>
        </div>
        <p class="line-hint">{{ t('analyzer.lineHint') }}</p>
        <div class="laps">
          <span class="lap-count">{{
            lapStore.excluded.length > 0
              ? t('analyzer.lapCountExcluded', { n: laps.length, x: lapStore.excluded.length })
              : t('analyzer.lapCount', { n: laps.length })
          }}</span>
          <button type="button" class="reset" @click="resetLine">
            {{ t('analyzer.resetLine') }}
          </button>
        </div>
        <div class="band" role="group" :aria-label="t('analyzer.lapBand')">
          <span class="band-label">{{ t('analyzer.lapBand') }}</span>
          <input
            type="number"
            inputmode="decimal"
            min="0"
            step="0.1"
            class="band-input"
            :value="bandMin ?? ''"
            :placeholder="t('analyzer.lapBandMin')"
            :aria-label="t('analyzer.lapBandMin')"
            @input="onBandInput('min', $event)"
          />
          <span class="band-sep">–</span>
          <input
            type="number"
            inputmode="decimal"
            min="0"
            step="0.1"
            class="band-input"
            :value="bandMax ?? ''"
            :placeholder="t('analyzer.lapBandMax')"
            :aria-label="t('analyzer.lapBandMax')"
            @input="onBandInput('max', $event)"
          />
          <button
            v-if="lapStore.lapTimeBand"
            type="button"
            class="band-clear"
            @click="lapStore.clearLapTimeBand()"
          >
            {{ t('analyzer.lapBandClear') }}
          </button>
          <span v-if="bandExcludedCount > 0" class="band-count">
            {{ t('analyzer.lapBandExcluded', { x: bandExcludedCount }) }}
          </span>
        </div>
        <SectorPanel :laps="laps" :invalid-count="sectorInvalidCount" />
        <LapTable
          :laps="laps"
          :track="track"
          :time-ms="timeMs"
          :session="session"
          :has-ecu-laps="hasEcuLaps"
          @select="onLapSelect"
        />
      </div>

      <div v-if="showMapAlign" class="card">
        <MapAlignPanel :selected-laps="selectedLaps" />
      </div>

      <div v-if="showAlign" class="card">
        <LapAlignPanel :selected-laps="selectedLaps" />
      </div>

      <div v-for="c in charts" :key="c.id" class="card">
        <TimeSeriesChart
          v-if="session && xValues"
          :chart="c"
          :session="session"
          :x-values="xValues"
          :x-range="xRange"
          :external-cursor="cursorIdx"
          :selected-laps="selectedLaps"
          @cursor="analyzer.setCursor"
          @x-zoom="onXZoom"
        />
      </div>

      <button type="button" class="add" @click="analyzer.addChart()">
        ＋ {{ t('analyzer.addChart') }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.analyzer {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 2);
}
.empty {
  color: var(--color-text-muted);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}
.record {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
.record select {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.xaxis {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.xaxis button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.xaxis button.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  padding: calc(var(--space) * 1.5);
}
.track-color {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: var(--space);
}
.tc-channel {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: var(--color-text-muted);
  flex: 1 1 220px;
  min-width: 200px;
}
.tc-channel :deep(.ss) {
  flex: 1;
}
.tc-maps {
  display: inline-flex;
  gap: 6px;
}
.tc-swatch {
  width: 40px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  cursor: pointer;
}
.tc-swatch.active {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
.tc-legend {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--space);
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.tc-bar {
  flex: 0 1 200px;
  height: 10px;
  border-radius: 5px;
  border: 1px solid var(--color-border);
}
.tc-name {
  color: var(--color-text);
}
.line-hint {
  margin: calc(var(--space) * 1.5) 0 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.laps {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: var(--space);
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
.reset {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.reset:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.band {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: var(--space);
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
.band-label {
  flex: 0 0 auto;
}
.band-input {
  width: 64px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.band-sep {
  color: var(--color-text-muted);
}
.band-clear {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.band-clear:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.band-count {
  color: var(--color-text-muted);
}
.add {
  align-self: flex-start;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius);
  padding: 8px 16px;
  font: inherit;
  cursor: pointer;
}
.add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
