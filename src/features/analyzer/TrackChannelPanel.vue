<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChannelExtremum } from '@/domain/analysis/cornerSpeed'
import { COLORMAP_IDS, colormapSwatches, type ColormapId } from '@/domain/analysis/colormap'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useLapStore } from '@/stores/lapStore'
import { formatExtremumValue } from '@/composables/useTrackExtrema'
import SearchableSelect from '@/components/SearchableSelect.vue'

// A9 — unified 軌跡上色 + 極值標記 control: pick ONE channel (any channel, not
// just speed), then independently colour the track by it and/or mark its
// local minima/maxima. Replaces the old CornerSpeedPanel (speed-only minima)
// + AnalyzerView's separate heatmap channel picker — this panel is now the
// SINGLE place the channel is chosen (AnalyzerView no longer duplicates it).
const props = defineProps<{
  options: { name: string; description?: string }[]
  /** Extrema for the focused lap, or the WHOLE TRACK when no single lap is
   *  focused (see useTrackExtrema's "No-lap fallback"), or null when the
   *  feature doesn't apply right now (no channel/track, or neither marker
   *  toggle is on) — see AnalyzerView's trackExtrema computed for the rule. */
  extrema: ChannelExtremum[] | null
  /** Whether at least one marker toggle is on but a channel isn't chosen yet
   *  vs. a channel IS chosen but there's no track data — distinguishes the
   *  two "nothing to show yet" hints. */
  channelChosen: boolean
}>()

const { t } = useI18n()
const analyzer = useAnalyzerStore()
const lapStore = useLapStore()

// Mirrors AnalyzerView's own `focusedLap` rule (exactly one lap selected) so
// the panel can tell apart "showing this lap's extrema" from "showing the
// whole-track fallback" without AnalyzerView needing to pass that down
// separately — `lapStore.selected` is the same source AnalyzerView derives
// `focusedLap` from.
const isSingleLapFocused = computed(() => lapStore.selected.length === 1)

function colormapPreview(id: ColormapId): string {
  return `linear-gradient(to right, ${colormapSwatches(id, 8).join(',')})`
}

// Formatting delegated to useTrackExtrema's formatExtremumValue so this
// list and TrackMap's map labels always agree on the same channel's display
// (magnitude-adaptive decimals — see that function's doc comment).
const fmtValue = formatExtremumValue

const markersRequested = () => analyzer.markMinima || analyzer.markMaxima
</script>

<template>
  <div class="track-channel-panel">
    <div class="tc-title">{{ t('analyzer.trackChannelTitle') }}</div>

    <label class="tc-channel">
      <span>{{ t('analyzer.trackChannel') }}</span>
      <SearchableSelect
        :model-value="analyzer.trackChannel"
        :options="props.options"
        @update:model-value="analyzer.setTrackChannel($event)"
      />
    </label>

    <div class="tc-toggles">
      <label class="toggle">
        <input
          type="checkbox"
          :checked="analyzer.trackColorEnabled"
          :disabled="!analyzer.trackChannel"
          @change="analyzer.setTrackColorEnabled(($event.target as HTMLInputElement).checked)"
        />
        <span>{{ t('analyzer.trackColor') }}</span>
      </label>
      <label class="toggle">
        <input
          type="checkbox"
          :checked="analyzer.markMinima"
          :disabled="!analyzer.trackChannel"
          @change="analyzer.setMarkMinima(($event.target as HTMLInputElement).checked)"
        />
        <span>{{ t('analyzer.markMinima') }}</span>
      </label>
      <label class="toggle">
        <input
          type="checkbox"
          :checked="analyzer.markMaxima"
          :disabled="!analyzer.trackChannel"
          @change="analyzer.setMarkMaxima(($event.target as HTMLInputElement).checked)"
        />
        <span>{{ t('analyzer.markMaxima') }}</span>
      </label>
    </div>

    <div v-if="analyzer.trackColorEnabled && analyzer.trackChannel" class="tc-maps" role="group" :aria-label="t('analyzer.colormap')">
      <button
        v-for="id in COLORMAP_IDS"
        :key="id"
        type="button"
        class="tc-swatch"
        :class="{ active: analyzer.trackColormap === id }"
        :style="{ background: colormapPreview(id) }"
        v-tooltip="id"
        @click="analyzer.setTrackColormap(id)"
      />
    </div>

    <p class="hint">{{ t('analyzer.trackChannelHint') }}</p>

    <template v-if="markersRequested()">
      <p v-if="!props.channelChosen" class="hint">{{ t('analyzer.trackChannelNoChannel') }}</p>
      <p v-else-if="props.extrema == null" class="hint">{{ t('analyzer.trackChannelNoTrack') }}</p>
      <template v-else>
        <p v-if="!isSingleLapFocused" class="hint scope-hint">{{ t('analyzer.trackChannelScopeTrack') }}</p>
        <p v-if="props.extrema.length === 0" class="hint">{{ t('analyzer.trackChannelNone') }}</p>
        <ul v-else class="extrema-list">
          <li v-for="(e, i) in props.extrema" :key="i" :class="e.kind">
            <span class="ex-kind">{{ e.kind === 'min' ? t('analyzer.extremumMin') : t('analyzer.extremumMax') }}</span>
            <span class="ex-dist">{{ (e.lapDistanceM / 1000).toFixed(2) }} km</span>
            <span class="ex-value">{{ fmtValue(e.value) }}</span>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>

<style scoped>
.track-channel-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tc-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text);
}
.tc-channel {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
.tc-channel :deep(.ss) {
  flex: 1;
}
.tc-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: var(--color-text);
  cursor: pointer;
}
.toggle:has(input:disabled) {
  color: var(--color-text-muted);
  cursor: not-allowed;
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
.hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.scope-hint {
  font-style: italic;
}
.extrema-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.extrema-list li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--radius);
  background: var(--color-bg);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}
.ex-kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  height: 18px;
  border-radius: 9px;
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-size: 0.7rem;
  font-weight: 600;
}
.extrema-list li.max .ex-kind {
  background: var(--color-text-muted);
  color: var(--color-surface);
}
.ex-dist {
  color: var(--color-text-muted);
}
.ex-value {
  color: var(--color-text);
  font-weight: 600;
}
</style>
