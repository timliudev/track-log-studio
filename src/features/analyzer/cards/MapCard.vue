<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AnalyzerCardContext } from '../analyzerCardContext'
import TrackMap from '../TrackMap.vue'

/**
 * The track-map card body — the ONLY extracted card whose content is more than
 * a single panel component: TrackMap plus the map's own sibling controls
 * (comparison map-align, heatmap legend, line hint, lap count + reset, and the
 * lap-time / lap-distance band inputs). Moved out of AnalyzerView's `#item`
 * slot verbatim (F1), so the map-specific scoped CSS below moved with it — a
 * parent's scoped styles never reach a child component's own template, so the
 * `.tc-legend`/`.band`/`.laps`/`.map-comparison-align`/… selectors have to
 * live here now.
 */
const props = defineProps<{ ctx: AnalyzerCardContext }>()
const {
  mapMaximized,
  track,
  cursorIdx,
  line,
  highlightLaps,
  comparisonLapHighlights,
  focusRange,
  colorValues,
  trackColormap,
  mapGates,
  allExtremaMarkers,
  overlayTracks,
  heatNorm,
  legendGradient,
  trackChannel,
  laps,
  excludedCount,
  bandMin,
  bandMax,
  distBandMin,
  distBandMax,
  bandExcludedCount,
  distBandExcludedCount,
  hasLapTimeBand,
  hasLapDistanceBand,
  setCursor,
  setLine,
  onUpdateGate,
  setMapMaximized,
  sessionOffsetOf,
  setComparisonMapOffset,
  resetSessionOffset,
  fmtVal,
  resetLine,
  onBandInput,
  clearLapTimeBand,
  onDistBandInput,
  clearLapDistanceBand,
} = props.ctx

const { t } = useI18n()
</script>

<template>
  <TrackMap
    fill-height
    :maximized="mapMaximized"
    :track="track"
    :cursor-idx="cursorIdx"
    :line="line"
    :highlight-laps="highlightLaps"
    :comparison-lap-highlights="comparisonLapHighlights"
    :focus-range="focusRange"
    :color-values="colorValues"
    :colormap="trackColormap"
    :gates="mapGates"
    :extrema-markers="allExtremaMarkers"
    :overlay-tracks="overlayTracks"
    @cursor="setCursor"
    @update:line="setLine"
    @update:gate="onUpdateGate"
    @update:maximized="setMapMaximized"
  />
  <details v-if="!mapMaximized && overlayTracks.length" class="map-comparison-align">
    <summary>{{ t('analyzer.comparisonMapAlign') }}</summary>
    <div v-for="entry in overlayTracks" :key="entry.id" class="map-offset-row">
      <span class="comparison-swatch" :style="{ background: entry.color }" />
      <span class="comparison-name" :title="entry.label">{{ entry.label }}</span>
      <label>
        {{ t('analyzer.comparisonMapEast') }}
        <input
          type="number"
          step="0.5"
          :value="sessionOffsetOf(entry.id).mapX"
          @change="setComparisonMapOffset(entry.id, 'mapX', $event)"
        />
      </label>
      <label>
        {{ t('analyzer.comparisonMapNorth') }}
        <input
          type="number"
          step="0.5"
          :value="sessionOffsetOf(entry.id).mapY"
          @change="setComparisonMapOffset(entry.id, 'mapY', $event)"
        />
      </label>
      <span>m</span>
      <button
        type="button"
        @click="resetSessionOffset(entry.id, 'mapX'); resetSessionOffset(entry.id, 'mapY')"
      >
        {{ t('analyzer.comparisonReset') }}
      </button>
    </div>
  </details>
  <div v-if="!mapMaximized && heatNorm" class="tc-legend">
    <span class="tc-end">{{ fmtVal(heatNorm.min) }}</span>
    <span class="tc-bar" :style="{ background: legendGradient }" />
    <span class="tc-end">{{ fmtVal(heatNorm.max) }}</span>
    <span class="tc-name">{{ trackChannel }}</span>
  </div>
  <p v-if="!mapMaximized" class="line-hint">{{ t('analyzer.lineHint') }}</p>
  <div v-if="!mapMaximized" class="laps">
    <span class="lap-count">{{
      excludedCount > 0
        ? t('analyzer.lapCountExcluded', { n: laps.length, x: excludedCount })
        : t('analyzer.lapCount', { n: laps.length })
    }}</span>
    <button type="button" class="reset" @click="resetLine">
      {{ t('analyzer.resetLine') }}
    </button>
  </div>
  <div v-if="!mapMaximized" class="band" role="group" :aria-label="t('analyzer.lapBand')">
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
      v-if="hasLapTimeBand"
      type="button"
      class="band-clear"
      @click="clearLapTimeBand()"
    >
      {{ t('analyzer.lapBandClear') }}
    </button>
    <span v-if="bandExcludedCount > 0" class="band-count">
      {{ t('analyzer.lapBandExcluded', { x: bandExcludedCount }) }}
    </span>
  </div>
  <div v-if="!mapMaximized" class="band" role="group" :aria-label="t('analyzer.lapDistanceBand')">
    <span class="band-label">{{ t('analyzer.lapDistanceBand') }}</span>
    <input
      type="number"
      inputmode="decimal"
      min="0"
      step="0.001"
      class="band-input"
      :value="distBandMin ?? ''"
      :placeholder="t('analyzer.lapDistanceBandMin')"
      :aria-label="t('analyzer.lapDistanceBandMin')"
      @input="onDistBandInput('min', $event)"
    />
    <span class="band-sep">–</span>
    <input
      type="number"
      inputmode="decimal"
      min="0"
      step="0.001"
      class="band-input"
      :value="distBandMax ?? ''"
      :placeholder="t('analyzer.lapDistanceBandMax')"
      :aria-label="t('analyzer.lapDistanceBandMax')"
      @input="onDistBandInput('max', $event)"
    />
    <button
      v-if="hasLapDistanceBand"
      type="button"
      class="band-clear"
      @click="clearLapDistanceBand()"
    >
      {{ t('analyzer.lapDistanceBandClear') }}
    </button>
    <span v-if="distBandExcludedCount > 0" class="band-count">
      {{ t('analyzer.lapDistanceBandExcluded', { x: distBandExcludedCount }) }}
    </span>
  </div>
</template>

<style scoped>
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
.comparison-swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: none;
  box-shadow: 0 0 0 1px var(--color-surface);
}
.comparison-name {
  max-width: 16em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.map-comparison-align {
  margin-top: var(--space);
  padding: 7px 9px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-bg);
  font-size: 0.8rem;
}
.map-comparison-align summary {
  cursor: pointer;
  font-weight: 600;
}
.map-offset-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 8px;
  padding-top: 7px;
  color: var(--color-text-muted);
}
.map-offset-row label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.map-offset-row input {
  width: 68px;
  padding: 3px 5px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  color: var(--color-text);
}
.map-offset-row button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 3px 8px;
  font: inherit;
  cursor: pointer;
}
.map-offset-row button:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
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
</style>
